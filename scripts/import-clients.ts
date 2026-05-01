// Import idempotent du fichier clients depuis data/legacy-excel/BDD.xlsx (feuille BDDC).
// Upsert sur clients.code. Pas de catégorie en source — laissée à null.
// La colonne "TVA" du fichier est en réalité le n° de TVA intracom → mappée sur vatNumber.
// La colonne "ZG" → geoZone. INT1NOM/TEL/FONC/MAIL → premier élément du tableau contacts.
import { config } from "dotenv";
config({ path: ".env.local" });

import ExcelJS from "exceljs";
import path from "node:path";
import { eq } from "drizzle-orm";

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) {
      return (v as { richText: { text: string }[] }).richText
        .map((t) => t.text)
        .join("");
    }
    if ("text" in v) return String((v as { text: string }).text);
    if ("hyperlink" in v) {
      const o = v as { text?: string; hyperlink: string };
      return String(o.text ?? o.hyperlink);
    }
    if ("result" in v) return String((v as { result: unknown }).result ?? "");
  }
  return String(v);
}

async function main() {
  const { db, schema } = await import("../lib/db");

  const file = path.resolve("data/legacy-excel/BDD.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const ws = wb.getWorksheet("BDDC");
  if (!ws) throw new Error("Feuille BDDC introuvable");

  const header = (ws.getRow(1).values as unknown[]).map(cellText);
  const idx = (name: string) => {
    const i = header.findIndex((h) => h === name);
    if (i < 0) throw new Error(`colonne ${name} introuvable`);
    return i;
  };

  const C = {
    code: idx("CODE"),
    nom: idx("NOM"),
    adrFact: idx("ADRESSEFACT"),
    villeFact: idx("VILLEFACT"),
    cpFact: idx("CPFACT"),
    adrLiv: idx("ADRESSELIV"),
    villeLiv: idx("VILLELIV"),
    cpLiv: idx("CPLIV"),
    raison: idx("RAISON SOCIALE"),
    siret: idx("SIRET"),
    iban: idx("IBAN"),
    tva: idx("TVA"),
    zg: idx("ZG"),
    int1Nom: idx("INT1NOM"),
    int1Tel: idx("INT1TEL"),
    int1Fonc: idx("INT1FONC"),
    int1Mail: idx("INT1MAIL"),
  };

  const norm = (v: unknown) => cellText(v).trim() || null;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const issues: string[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = norm(row.getCell(C.code).value);
    if (!code) {
      skipped++;
      continue;
    }
    const name = norm(row.getCell(C.nom).value);
    if (!name) {
      issues.push(`ligne ${r} : ${code} sans nom, ignoré`);
      skipped++;
      continue;
    }

    const contactName = norm(row.getCell(C.int1Nom).value);
    const contactPhone = norm(row.getCell(C.int1Tel).value);
    const contactRole = norm(row.getCell(C.int1Fonc).value);
    const contactEmail = norm(row.getCell(C.int1Mail).value);
    const contacts =
      contactName || contactPhone || contactEmail
        ? [
            {
              name: contactName ?? undefined,
              role: contactRole ?? undefined,
              phone: contactPhone ?? undefined,
              email: contactEmail ?? undefined,
            },
          ]
        : [];

    const values = {
      code,
      name,
      legalName: norm(row.getCell(C.raison).value),
      siret: norm(row.getCell(C.siret).value),
      vatNumber: norm(row.getCell(C.tva).value),
      iban: norm(row.getCell(C.iban).value),
      billingAddress: norm(row.getCell(C.adrFact).value),
      billingCity: norm(row.getCell(C.villeFact).value),
      billingZip: norm(row.getCell(C.cpFact).value),
      shippingAddress: norm(row.getCell(C.adrLiv).value),
      shippingCity: norm(row.getCell(C.villeLiv).value),
      shippingZip: norm(row.getCell(C.cpLiv).value),
      geoZone: norm(row.getCell(C.zg).value),
      contacts,
      updatedAt: new Date(),
    };

    const existing = await db.query.clients.findFirst({
      where: eq(schema.clients.code, code),
    });
    if (existing) {
      await db
        .update(schema.clients)
        .set(values)
        .where(eq(schema.clients.id, existing.id));
      updated++;
    } else {
      await db.insert(schema.clients).values(values);
      inserted++;
    }
  }

  console.log("\n━━━ Import clients terminé ━━━");
  console.log(`  ${inserted} clients créés`);
  console.log(`  ${updated} clients mis à jour`);
  console.log(`  ${skipped} lignes ignorées`);
  if (issues.length) {
    console.log("\nProblèmes :");
    for (const i of issues) console.log(`  - ${i}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
