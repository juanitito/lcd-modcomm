// Backfill rename des PDFs de factures fournisseurs vers la nomenclature
// YYMMDD-LCD-FacFour-{code}-{numero}.pdf, rangés par année dans
// factures-achat/{YYYY}/.
//
// Idempotent : skip ce qui est déjà au bon path.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db, schema } = await import("../lib/db");
  const { eq } = await import("drizzle-orm");
  const { put } = await import("@vercel/blob");
  const { buildSupplierInvoiceBlobPath } = await import("../lib/invoicing");

  const all = await db.query.supplierInvoices.findMany();
  console.log(`${all.length} factures fournisseurs à examiner.\n`);

  let renamed = 0;
  let skipped = 0;
  let failed = 0;

  for (const inv of all) {
    if (!inv.pdfBlobUrl) {
      console.log(`  ⚠ ${inv.supplierInvoiceNumber} : pas de pdfBlobUrl`);
      skipped++;
      continue;
    }
    const supplier = await db.query.suppliers.findFirst({
      where: eq(schema.suppliers.id, inv.supplierId),
    });
    if (!supplier) {
      console.log(`  ⚠ ${inv.supplierInvoiceNumber} : fournisseur introuvable`);
      skipped++;
      continue;
    }
    const newPath = buildSupplierInvoiceBlobPath(
      inv.issueDate,
      supplier.code,
      inv.supplierInvoiceNumber,
    );
    if (inv.pdfBlobPath === newPath) {
      skipped++;
      continue;
    }
    try {
      const r = await fetch(inv.pdfBlobUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const blob = await put(newPath, buf, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      await db
        .update(schema.supplierInvoices)
        .set({ pdfBlobUrl: blob.url, pdfBlobPath: blob.pathname })
        .where(eq(schema.supplierInvoices.id, inv.id));
      console.log(
        `  ✓ ${inv.supplierInvoiceNumber} → ${newPath}`,
      );
      renamed++;
    } catch (e) {
      console.log(`  ✗ ${inv.supplierInvoiceNumber} : ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }
  console.log(
    `\n${renamed} renommée(s), ${skipped} skippée(s) (déjà OK), ${failed} échec(s).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
