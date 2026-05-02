// Matérialise en masse les imports en status='extracted' (avec contrepartie matchée).
// Mirroir de l'action server materializeImport, sans requireAuth.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq, and: dAnd } = await import("drizzle-orm");
  const { db, schema } = await import("../lib/db");

  const ready = await db.query.invoiceImports.findMany({
    where: eq(schema.invoiceImports.status, "extracted"),
  });
  console.log(`${ready.length} import(s) prêt(s) à matérialiser`);

  let ok = 0;
  let skip = 0;
  let err = 0;

  for (const imp of ready) {
    const ex = imp.extracted;
    if (!ex || !ex.legacyNumber || !ex.issueDate || !ex.totals) {
      console.log(`  - ${imp.sourceFilename ?? imp.id.slice(0, 8)} : données extraites incomplètes (skip)`);
      skip++;
      continue;
    }

    try {
      if (imp.direction === "client" && imp.matchedClientId) {
        const client = await db.query.clients.findFirst({
          where: eq(schema.clients.id, imp.matchedClientId),
        });
        if (!client) throw new Error("Client introuvable");

        const invoiceNumber = `LEGACY-${ex.legacyNumber}`;
        const existing = await db.query.invoices.findFirst({
          where: eq(schema.invoices.invoiceNumber, invoiceNumber),
        });
        if (existing) throw new Error(`Facture ${invoiceNumber} déjà existante`);

        const [created] = await db
          .insert(schema.invoices)
          .values({
            invoiceNumber,
            legacyNumber: ex.legacyNumber,
            type: "invoice",
            clientId: client.id,
            clientSnapshot: {
              name: client.name,
              legalName: client.legalName ?? undefined,
              siret: client.siret ?? undefined,
              vatNumber: client.vatNumber ?? undefined,
              billingAddress: client.billingAddress ?? undefined,
              billingCity: client.billingCity ?? undefined,
              billingZip: client.billingZip ?? undefined,
              shippingAddress: client.shippingAddress ?? undefined,
              shippingCity: client.shippingCity ?? undefined,
              shippingZip: client.shippingZip ?? undefined,
            },
            issueDate: ex.issueDate,
            dueDate: ex.dueDate ?? null,
            paymentTerms: client.paymentTerms,
            totalHt: String(ex.totals.totalHt),
            totalVat: String(ex.totals.totalVat),
            totalTtc: String(ex.totals.totalTtc),
            vatBreakdown: (ex.vatBreakdown ?? []).map((b) => ({
              rate: b.rate.toFixed(2),
              base: b.base.toFixed(2),
              vat: b.vat.toFixed(2),
            })),
            pdfBlobUrl: imp.pdfBlobUrl,
            pdfBlobPath: imp.pdfBlobPath,
            status: "issued",
          })
          .returning({ id: schema.invoices.id });

        for (const [i, l] of (ex.lines ?? []).entries()) {
          await db.insert(schema.invoiceLines).values({
            invoiceId: created.id,
            code: "",
            designation: l.designation,
            qty: String(l.qty),
            unitPriceHt: String(l.unitPriceHt),
            vatRate: l.vatRate.toFixed(2),
            lineTotalHt:
              l.lineTotalHt != null
                ? String(l.lineTotalHt)
                : (l.qty * l.unitPriceHt).toFixed(2),
            position: i,
          });
        }

        await db
          .update(schema.invoiceImports)
          .set({
            status: "materialized",
            materializedInvoiceId: created.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoiceImports.id, imp.id));
        console.log(`  ✓ client ${invoiceNumber}`);
        ok++;
      } else if (imp.direction === "supplier" && imp.matchedSupplierId) {
        const supplier = await db.query.suppliers.findFirst({
          where: eq(schema.suppliers.id, imp.matchedSupplierId),
        });
        if (!supplier) throw new Error("Fournisseur introuvable");

        const existing = await db.query.supplierInvoices.findFirst({
          where: dAnd(
            eq(schema.supplierInvoices.supplierId, supplier.id),
            eq(schema.supplierInvoices.supplierInvoiceNumber, ex.legacyNumber),
          ),
        });
        if (existing)
          throw new Error(`Facture ${ex.legacyNumber} déjà existante pour ${supplier.name}`);

        const [created] = await db
          .insert(schema.supplierInvoices)
          .values({
            supplierInvoiceNumber: ex.legacyNumber,
            type: "invoice",
            supplierId: supplier.id,
            supplierSnapshot: {
              name: supplier.name,
              legalName: supplier.legalName ?? undefined,
              siret: supplier.siret ?? undefined,
              vatNumber: supplier.vatNumber ?? undefined,
            },
            issueDate: ex.issueDate,
            dueDate: ex.dueDate ?? null,
            totalHt: String(ex.totals.totalHt),
            totalVat: String(ex.totals.totalVat),
            totalTtc: String(ex.totals.totalTtc),
            vatBreakdown: (ex.vatBreakdown ?? []).map((b) => ({
              rate: b.rate.toFixed(2),
              base: b.base.toFixed(2),
              vat: b.vat.toFixed(2),
            })),
            pdfBlobUrl: imp.pdfBlobUrl,
            pdfBlobPath: imp.pdfBlobPath,
            status: "issued",
          })
          .returning({ id: schema.supplierInvoices.id });

        for (const [i, l] of (ex.lines ?? []).entries()) {
          await db.insert(schema.supplierInvoiceLines).values({
            supplierInvoiceId: created.id,
            designation: l.designation,
            qty: String(l.qty),
            unitPriceHt: String(l.unitPriceHt),
            vatRate: l.vatRate.toFixed(2),
            lineTotalHt:
              l.lineTotalHt != null
                ? String(l.lineTotalHt)
                : (l.qty * l.unitPriceHt).toFixed(2),
            position: i,
          });
        }

        await db
          .update(schema.invoiceImports)
          .set({
            status: "materialized",
            materializedSupplierInvoiceId: created.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoiceImports.id, imp.id));
        console.log(`  ✓ fournisseur ${ex.legacyNumber} (${supplier.name})`);
        ok++;
      } else {
        console.log(`  - ${imp.sourceFilename ?? imp.id.slice(0, 8)} : direction/match incohérent (skip)`);
        skip++;
      }
    } catch (e) {
      console.log(
        `  ✗ ${imp.sourceFilename ?? imp.id.slice(0, 8)} : ${e instanceof Error ? e.message : String(e)}`,
      );
      err++;
    }
  }

  console.log(`\n${ok} matérialisées, ${skip} skip, ${err} erreurs.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
