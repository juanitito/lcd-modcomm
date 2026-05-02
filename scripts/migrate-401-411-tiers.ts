// Migration : reaffecte les journal_lines qui pointent vers '401' ou '411'
// (compte parent) ET qui ont un matched_supplier_invoice_id ou matched_invoice_id
// vers leur sous-compte tiers correct '401-{code}' / '411-{code}'.
// Réécrit en place — pas de suppression d'écritures.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db, schema } = await import("../lib/db");
  const { eq, and, isNotNull } = await import("drizzle-orm");
  const { ensureTierAccount } = await import("../lib/accounting");

  // ---- 401 : payments fournisseurs via split ----
  const suppLines = await db
    .select({
      lineId: schema.journalLines.id,
      siId: schema.journalLines.matchedSupplierInvoiceId,
      currentCode: schema.journalLines.accountCode,
    })
    .from(schema.journalLines)
    .where(
      and(
        eq(schema.journalLines.accountCode, "401"),
        isNotNull(schema.journalLines.matchedSupplierInvoiceId),
      ),
    );

  console.log(`401 → tier : ${suppLines.length} ligne(s) à migrer`);
  for (const l of suppLines) {
    if (!l.siId) continue;
    const si = await db.query.supplierInvoices.findFirst({
      where: eq(schema.supplierInvoices.id, l.siId),
    });
    if (!si) continue;
    const supplier = await db.query.suppliers.findFirst({
      where: eq(schema.suppliers.id, si.supplierId),
    });
    if (!supplier) continue;
    const newCode = await ensureTierAccount("401", supplier.code, supplier.name);
    await db
      .update(schema.journalLines)
      .set({ accountCode: newCode })
      .where(eq(schema.journalLines.id, l.lineId));
    console.log(`  ✓ ${l.lineId.slice(0, 8)} → ${newCode} (facture ${si.supplierInvoiceNumber})`);
  }

  // ---- 411 : encaissements clients via split ----
  const cliLines = await db
    .select({
      lineId: schema.journalLines.id,
      invId: schema.journalLines.matchedInvoiceId,
      currentCode: schema.journalLines.accountCode,
    })
    .from(schema.journalLines)
    .where(
      and(
        eq(schema.journalLines.accountCode, "411"),
        isNotNull(schema.journalLines.matchedInvoiceId),
      ),
    );

  console.log(`\n411 → tier : ${cliLines.length} ligne(s) à migrer`);
  for (const l of cliLines) {
    if (!l.invId) continue;
    const inv = await db.query.invoices.findFirst({
      where: eq(schema.invoices.id, l.invId),
    });
    if (!inv) continue;
    const client = await db.query.clients.findFirst({
      where: eq(schema.clients.id, inv.clientId),
    });
    if (!client) continue;
    const newCode = await ensureTierAccount("411", client.code, client.name);
    await db
      .update(schema.journalLines)
      .set({ accountCode: newCode })
      .where(eq(schema.journalLines.id, l.lineId));
    console.log(`  ✓ ${l.lineId.slice(0, 8)} → ${newCode} (facture ${inv.invoiceNumber})`);
  }

  console.log("\n=== Vérification post-migration : soldes 401-* et 411-* ===");
  const all = await db.query.journalLines.findMany({
    columns: { accountCode: true, debit: true, credit: true },
  });
  const balances = new Map<string, number>();
  for (const l of all) {
    if (!l.accountCode.startsWith("401") && !l.accountCode.startsWith("411")) continue;
    balances.set(
      l.accountCode,
      (balances.get(l.accountCode) ?? 0) + Number(l.debit) - Number(l.credit),
    );
  }
  for (const [code, bal] of [...balances.entries()].sort()) {
    console.log(`  ${code.padEnd(15)}  Solde=${bal.toFixed(2).padStart(10)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
