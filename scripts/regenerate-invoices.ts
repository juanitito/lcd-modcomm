// Renumérotation + régénération PDF des factures clients legacy.
//
// Phase 1 (default) : génère les PDFs dans regenerated-invoices/ pour relecture.
//                     N'écrit RIEN en DB ni en Blob.
// Phase 2 (--commit) : upload Blob + UPDATE invoices (invoiceNumber, pdf*).
//
// Idempotent : computeChronoNumbers est déterministe, on peut relancer.
// Le legacyNumber est conservé en DB comme piste d'audit.

import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "node:fs";
import path from "node:path";

const COMMIT = process.argv.includes("--commit");

type LineRow = {
  code: string;
  designation: string;
  conditionnement: string | null;
  qty: number;
  unitPriceHt: number;
  vatRate: number;
  lineTotalHt: number;
};

type RenderData = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  client: {
    code: string;
    name: string;
    billingAddress?: string;
    billingCity?: string;
    billingZip?: string;
  };
  shipping: {
    name: string;
    address?: string;
    city?: string;
    zip?: string;
  };
  lines: Array<{
    code: string;
    designation: string;
    conditionnement: string;
    qty: string;
    unitPriceHt: string;
    vatRate: string;
    lineTotalHt: string;
  }>;
  totalHt: string;
  totalTtc: string;
  vatBreakdown: Array<{ rate: string; vat: string }>;
};

function fmtEur(n: number | string): string {
  const num = typeof n === "string" ? Number(n) : n;
  return num.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtVatRate(rate: number | string): string {
  const num = typeof rate === "string" ? Number(rate) : rate;
  // Si entier (ex 20.00) on affiche sans décimales, sinon avec.
  return Number.isInteger(num) ? `${num} %` : `${num.toString().replace(".", ",")} %`;
}

async function main() {
  const { db, schema } = await import("../lib/db");
  const { eq, asc } = await import("drizzle-orm");
  const { computeChronoNumbers } = await import("../lib/invoicing");
  const Handlebars = (await import("handlebars")).default;

  console.log(`Mode : ${COMMIT ? "🚨 COMMIT (DB + Blob)" : "🔍 DRY-RUN (PDFs locaux uniquement)"}\n`);

  // 1. Charger toutes les factures + leurs lignes + le client
  const invoices = await db.query.invoices.findMany({
    orderBy: asc(schema.invoices.issueDate),
  });
  console.log(`${invoices.length} factures à traiter.`);

  const newNumbers = computeChronoNumbers(
    invoices.map((i) => ({ id: i.id, issueDate: i.issueDate, createdAt: i.createdAt })),
  );

  // 2. Charger le template + compiler
  const tplPath = path.resolve(process.cwd(), "templates", "lcd-facture.html");
  const tpl = Handlebars.compile(await fs.readFile(tplPath, "utf8"));

  // 3. Préparer la sortie
  const outDir = path.resolve(process.cwd(), "regenerated-invoices");
  await fs.mkdir(outDir, { recursive: true });

  // 4. Démarrer puppeteer une fois
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    args: ["--no-sandbox"],
  });

  type CommitPlan = Array<{
    id: string;
    newNumber: string;
    pdfPath: string;
  }>;
  const commitPlan: CommitPlan = [];

  try {
    for (const inv of invoices) {
      const newNumber = newNumbers.get(inv.id)!;

      // Charger les lignes + le client
      const lines = await db.query.invoiceLines.findMany({
        where: eq(schema.invoiceLines.invoiceId, inv.id),
        orderBy: asc(schema.invoiceLines.position),
      });
      const client = await db.query.clients.findFirst({
        where: eq(schema.clients.id, inv.clientId),
      });

      // Le snapshot fait foi (état à l'émission) sauf pour le code (pas dans le snapshot)
      const snap = inv.clientSnapshot ?? {};

      const data: RenderData = {
        invoiceNumber: newNumber,
        issueDate: fmtDate(inv.issueDate),
        dueDate: inv.dueDate ? fmtDate(inv.dueDate) : "À réception",
        client: {
          code: client?.code ?? "—",
          name: snap.name ?? client?.name ?? "—",
          billingAddress: snap.billingAddress,
          billingCity: snap.billingCity,
          billingZip: snap.billingZip,
        },
        shipping: {
          name: snap.shippingAddress ? "Adresse de livraison" : "Identique à la facturation",
          address: snap.shippingAddress,
          city: snap.shippingCity,
          zip: snap.shippingZip,
        },
        lines: lines.map((l) => ({
          code: l.code,
          designation: l.designation,
          conditionnement: "", // l'app ne stocke pas ce champ par ligne aujourd'hui
          qty: l.qty.toString(),
          unitPriceHt: fmtEur(l.unitPriceHt),
          vatRate: fmtVatRate(l.vatRate),
          lineTotalHt: fmtEur(l.lineTotalHt),
        })),
        totalHt: fmtEur(inv.totalHt),
        totalTtc: fmtEur(inv.totalTtc),
        vatBreakdown: (inv.vatBreakdown ?? []).map((b) => ({
          rate: fmtVatRate(b.rate),
          vat: fmtEur(b.vat),
        })),
      };

      const html = tpl(data);

      // Render PDF
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfBuf = await page.pdf({ format: "A4", printBackground: true });
      await page.close();

      const pdfPath = path.join(outDir, `${newNumber}.pdf`);
      await fs.writeFile(pdfPath, pdfBuf);
      console.log(
        `  ✓ ${newNumber}  ${inv.issueDate}  ${inv.totalTtc}€  → ${pdfPath} (legacy: ${inv.legacyNumber})`,
      );

      commitPlan.push({ id: inv.id, newNumber, pdfPath });
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\n${commitPlan.length} PDF(s) écrit(s) dans ${outDir}.`,
  );

  if (!COMMIT) {
    console.log(
      "\n→ Phase 1 (dry-run) terminée. Vérifie les PDFs ci-dessus, puis relance avec --commit pour appliquer en base.",
    );
    return;
  }

  // ----- Phase 2 : Upload Blob + UPDATE DB -----
  console.log("\n=== Phase 2 : upload Blob + DB ===");
  const { put } = await import("@vercel/blob");

  for (const c of commitPlan) {
    const pdfBuf = await fs.readFile(c.pdfPath);
    const blobPath = `invoices/regenerated/${c.newNumber}.pdf`;
    const blob = await put(blobPath, pdfBuf, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    await db
      .update(schema.invoices)
      .set({
        invoiceNumber: c.newNumber,
        pdfBlobUrl: blob.url,
        pdfBlobPath: blob.pathname,
      })
      .where(eq(schema.invoices.id, c.id));
    console.log(`  ✓ ${c.newNumber} : DB updated, blob ${blob.url}`);
  }

  console.log(`\n✅ Phase 2 terminée : ${commitPlan.length} factures renumérotées en base.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
