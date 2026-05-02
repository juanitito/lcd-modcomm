import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const { db } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM qonto_transactions) AS tx_total,
      (SELECT count(*) FROM qonto_transactions WHERE matched_invoice_id IS NOT NULL) AS tx_matched_client,
      (SELECT count(*) FROM qonto_transactions WHERE matched_supplier_invoice_id IS NOT NULL) AS tx_matched_supplier,
      (SELECT count(*) FROM invoices WHERE invoice_number LIKE 'LEGACY-%') AS legacy_invoices,
      (SELECT count(*) FROM supplier_invoices) AS supplier_invoices,
      (SELECT count(*) FROM suppliers) AS suppliers,
      (SELECT coalesce(sum(total_ttc),0) FROM supplier_invoices) AS total_supplier_ttc,
      (SELECT coalesce(sum(total_ttc),0) FROM invoices) AS total_client_ttc
  `);
  console.log(JSON.stringify(r.rows[0], null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
