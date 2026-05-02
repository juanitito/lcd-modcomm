// Backfill des écritures comptables manquantes pour le legacy.
// Idempotent : skip ce qui a déjà une écriture.
//
// Couvre :
// - Issuance de toutes les invoices (clients) → JE en VE
// - Issuance de toutes les supplier_invoices → JE en AC
// - Paiement de toutes les qonto_transactions matchées sans JE déjà liée → JE en BQ
//
// Les classifications (kinds) et les splits ont déjà leur JE — pas touché.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db, schema } = await import("../lib/db");
  const { eq, and, isNotNull, isNull, sql } = await import("drizzle-orm");
  const {
    writeClientInvoiceIssuanceJE,
    writeSupplierInvoiceIssuanceJE,
    writeClientInvoicePaymentJE,
    writeSupplierInvoicePaymentJE,
  } = await import("../lib/accounting");

  console.log("=== Phase 2 — Backfill écritures comptables ===\n");

  // ---- 1. Issuance des factures clients (VE) ----
  const allInvoices = await db.query.invoices.findMany({
    columns: { id: true, invoiceNumber: true },
  });
  const existingVeInvoiceIds = new Set(
    (
      await db
        .select({ id: schema.journalEntries.invoiceId })
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.journal, "VE"),
            isNotNull(schema.journalEntries.invoiceId),
          ),
        )
    ).map((r) => r.id),
  );
  let veCreated = 0;
  for (const inv of allInvoices) {
    if (existingVeInvoiceIds.has(inv.id)) continue;
    await writeClientInvoiceIssuanceJE(inv.id);
    console.log(`  [VE] Émission ${inv.invoiceNumber}`);
    veCreated++;
  }
  console.log(`  → ${veCreated} écriture(s) de vente créée(s)\n`);

  // ---- 2. Issuance des factures fournisseurs (AC) ----
  // Pas de FK directe entry→supplier_invoice. On detect via journal_lines.matched_supplier_invoice_id.
  const allSuppliers = await db.query.supplierInvoices.findMany({
    columns: { id: true, supplierInvoiceNumber: true },
  });
  const existingAcSupplierIds = new Set(
    (
      await db
        .select({ id: schema.journalLines.matchedSupplierInvoiceId })
        .from(schema.journalLines)
        .innerJoin(
          schema.journalEntries,
          eq(schema.journalLines.entryId, schema.journalEntries.id),
        )
        .where(
          and(
            eq(schema.journalEntries.journal, "AC"),
            isNotNull(schema.journalLines.matchedSupplierInvoiceId),
          ),
        )
    ).map((r) => r.id),
  );
  let acCreated = 0;
  for (const inv of allSuppliers) {
    if (existingAcSupplierIds.has(inv.id)) continue;
    await writeSupplierInvoiceIssuanceJE(inv.id);
    console.log(`  [AC] Émission ${inv.supplierInvoiceNumber}`);
    acCreated++;
  }
  console.log(`  → ${acCreated} écriture(s) d'achat créée(s)\n`);

  // ---- 3. Paiements (BQ) sur tx Qonto matchées sans JE déjà liée ----
  const matchedTxs = await db
    .select({
      id: schema.qontoTransactions.id,
      matchedInvoiceId: schema.qontoTransactions.matchedInvoiceId,
      matchedSupplierInvoiceId:
        schema.qontoTransactions.matchedSupplierInvoiceId,
      journalEntryId: schema.qontoTransactions.journalEntryId,
      amount: schema.qontoTransactions.amount,
      date: schema.qontoTransactions.date,
    })
    .from(schema.qontoTransactions)
    .where(
      and(
        // Au moins un match facture
        sql`(${schema.qontoTransactions.matchedInvoiceId} IS NOT NULL OR ${schema.qontoTransactions.matchedSupplierInvoiceId} IS NOT NULL)`,
        // Pas encore d'écriture liée
        isNull(schema.qontoTransactions.journalEntryId),
      ),
    );
  let bqCreated = 0;
  for (const tx of matchedTxs) {
    let entryId: string | null = null;
    if (tx.matchedInvoiceId) {
      entryId = await writeClientInvoicePaymentJE(tx.id, tx.matchedInvoiceId);
    } else if (tx.matchedSupplierInvoiceId) {
      entryId = await writeSupplierInvoicePaymentJE(
        tx.id,
        tx.matchedSupplierInvoiceId,
      );
    }
    if (entryId) {
      await db
        .update(schema.qontoTransactions)
        .set({ journalEntryId: entryId })
        .where(eq(schema.qontoTransactions.id, tx.id));
      console.log(
        `  [BQ] ${tx.date} ${tx.amount}€ → ${tx.matchedInvoiceId ? "client" : "fournisseur"}`,
      );
      bqCreated++;
    }
  }
  console.log(`  → ${bqCreated} écriture(s) de paiement créée(s)\n`);

  // ---- 4. Marquer status=paid sur les invoices/supplier_invoices avec match exact ----
  let paidUpdates = 0;
  const allMatchedInvoices = await db
    .select({
      invoiceId: schema.qontoTransactions.matchedInvoiceId,
      txAmount: schema.qontoTransactions.amount,
      total: schema.invoices.totalTtc,
      status: schema.invoices.status,
    })
    .from(schema.qontoTransactions)
    .innerJoin(
      schema.invoices,
      eq(schema.qontoTransactions.matchedInvoiceId, schema.invoices.id),
    )
    .where(isNotNull(schema.qontoTransactions.matchedInvoiceId));
  for (const r of allMatchedInvoices) {
    if (
      r.status !== "paid" &&
      r.invoiceId &&
      Math.abs(Number(r.total) - Math.abs(Number(r.txAmount))) < 0.01
    ) {
      await db
        .update(schema.invoices)
        .set({ status: "paid" })
        .where(eq(schema.invoices.id, r.invoiceId));
      paidUpdates++;
    }
  }
  const allMatchedSuppInv = await db
    .select({
      siId: schema.qontoTransactions.matchedSupplierInvoiceId,
      txAmount: schema.qontoTransactions.amount,
      total: schema.supplierInvoices.totalTtc,
      status: schema.supplierInvoices.status,
    })
    .from(schema.qontoTransactions)
    .innerJoin(
      schema.supplierInvoices,
      eq(
        schema.qontoTransactions.matchedSupplierInvoiceId,
        schema.supplierInvoices.id,
      ),
    )
    .where(isNotNull(schema.qontoTransactions.matchedSupplierInvoiceId));
  for (const r of allMatchedSuppInv) {
    if (
      r.status !== "paid" &&
      r.siId &&
      Math.abs(Number(r.total) - Math.abs(Number(r.txAmount))) < 0.01
    ) {
      await db
        .update(schema.supplierInvoices)
        .set({ status: "paid" })
        .where(eq(schema.supplierInvoices.id, r.siId));
      paidUpdates++;
    }
  }
  console.log(`  → ${paidUpdates} facture(s) status='paid' alignée(s)\n`);

  console.log("=== Backfill terminé ===");
  console.log(
    `${veCreated} VE + ${acCreated} AC + ${bqCreated} BQ = ${veCreated + acCreated + bqCreated} écritures créées`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
