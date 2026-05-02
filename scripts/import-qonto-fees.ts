// Importe les factures de frais bancaires Qonto en exploitant les
// attachments associés à chaque transaction qonto_fee.
//
// Pour chaque transaction Qonto :
//   1. Fetch métadonnées attachment (URL S3 signée)
//   2. Télécharge le PDF, archive sur Vercel Blob
//   3. Crée une supplier_invoice (pas d'extraction LLM — la structure
//      est connue : 27.60€ TTC dont 20% TVA)
//   4. Rapproche directement la qonto_transaction à la facture créée
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq, isNotNull, sql } = await import("drizzle-orm");
  const { put } = await import("@vercel/blob");
  const { db, schema } = await import("../lib/db");
  const { getAttachment } = await import("../lib/qonto");

  // 1. Trouve / crée le fournisseur Qonto
  let qonto = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.code, "QONTO"),
  });
  if (!qonto) {
    const [created] = await db
      .insert(schema.suppliers)
      .values({
        code: "QONTO",
        name: "Qonto",
        legalName: "OLINDA SAS (Qonto)",
        contactEmail: "support@qonto.com",
      })
      .returning();
    qonto = created;
    console.log(`Fournisseur Qonto créé : ${qonto.id}`);
  } else {
    console.log(`Fournisseur Qonto déjà en base : ${qonto.id}`);
  }

  // 2. Toutes les transactions qonto_fee avec attachment, non encore rapprochées
  const txs = await db
    .select()
    .from(schema.qontoTransactions)
    .where(
      sql`(${schema.qontoTransactions.rawJson}->>'operation_type') = 'qonto_fee'
        AND jsonb_array_length(${schema.qontoTransactions.rawJson}->'attachment_ids') > 0`,
    );
  console.log(`${txs.length} transactions Qonto-fee avec attachment`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const tx of txs) {
    const raw = tx.rawJson as Record<string, unknown>;
    const attachmentIds = (raw.attachment_ids as string[]) ?? [];
    if (attachmentIds.length === 0) continue;

    // Si déjà rapprochée, skip
    if (tx.matchedSupplierInvoiceId) {
      skipped++;
      continue;
    }

    try {
      const attachmentId = attachmentIds[0];
      const att = await getAttachment(attachmentId);

      // Télécharge le PDF
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`Téléchargement Qonto: HTTP ${res.status}`);
      const pdfBuffer = Buffer.from(await res.arrayBuffer());

      // Upload sur notre Blob
      const blobPath = `invoices/qonto-fees/${att.file_name}`;
      const blob = await put(blobPath, pdfBuffer, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/pdf",
      });

      // Numéro de facture Qonto : extrait du nom de fichier "MM-YY-invoice-NNNNNNNN.pdf"
      const numMatch = att.file_name.match(/invoice-(\d+)/);
      const invoiceNumber = numMatch ? numMatch[1] : att.id.slice(0, 8);

      // Anti-doublon
      const existing = await db.query.supplierInvoices.findFirst({
        where: (si, { and: a, eq: e }) =>
          a(
            e(si.supplierId, qonto.id),
            e(si.supplierInvoiceNumber, invoiceNumber),
          ),
      });

      let supplierInvoiceId: string;
      if (existing) {
        supplierInvoiceId = existing.id;
        console.log(`  · ${invoiceNumber} déjà importée, juste rapprocher`);
      } else {
        // Construit la facture sans LLM — structure connue
        const totalTtc = Math.abs(Number(tx.amount));
        const vatAmount = raw.vat_amount != null ? Number(raw.vat_amount) : null;
        const vatRate = raw.vat_rate != null ? Number(raw.vat_rate) : 20;
        const totalVat =
          vatAmount != null ? vatAmount : Number((totalTtc * 0.2 / 1.2).toFixed(2));
        const totalHt = Number((totalTtc - totalVat).toFixed(2));

        const issueDate = (tx.settledAt ?? new Date(tx.date))
          .toISOString()
          .slice(0, 10);

        const [created] = await db
          .insert(schema.supplierInvoices)
          .values({
            supplierInvoiceNumber: invoiceNumber,
            type: "invoice",
            supplierId: qonto.id,
            supplierSnapshot: {
              name: qonto.name,
              legalName: qonto.legalName ?? undefined,
            },
            issueDate,
            totalHt: totalHt.toFixed(2),
            totalVat: totalVat.toFixed(2),
            totalTtc: totalTtc.toFixed(2),
            vatBreakdown: [
              {
                rate: vatRate.toFixed(2),
                base: totalHt.toFixed(2),
                vat: totalVat.toFixed(2),
              },
            ],
            pdfBlobUrl: blob.url,
            pdfBlobPath: blob.pathname,
            status: "paid",
            paidAt: tx.settledAt ?? new Date(tx.date),
            paidAmount: totalTtc.toFixed(2),
          })
          .returning({ id: schema.supplierInvoices.id });
        supplierInvoiceId = created.id;
        console.log(
          `  ✓ ${invoiceNumber} | ${issueDate} | ${totalTtc.toFixed(2)}€ (HT ${totalHt} + TVA ${totalVat})`,
        );
      }

      // Rapprochement direct
      await db
        .update(schema.qontoTransactions)
        .set({
          matchedSupplierInvoiceId: supplierInvoiceId,
          matchedAt: new Date(),
          matchNote: "Auto-import Qonto (attachment API)",
        })
        .where(eq(schema.qontoTransactions.id, tx.id));

      imported++;
    } catch (err) {
      console.log(
        `  ✗ ${tx.date} ${tx.amount}€ : ${err instanceof Error ? err.message : String(err)}`,
      );
      errors++;
    }
  }

  console.log(
    `\n${imported} importées+rapprochées, ${skipped} déjà rapprochées (skip), ${errors} erreurs.`,
  );
  // suppress unused warning
  void isNotNull;
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
