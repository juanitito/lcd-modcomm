import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");

  const r = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM qonto_transactions) AS qonto_total,
      (SELECT count(*) FROM qonto_transactions WHERE amount::numeric > 0) AS qonto_credits,
      (SELECT count(*) FROM qonto_transactions WHERE amount::numeric < 0) AS qonto_debits,
      (SELECT count(*) FROM qonto_transactions WHERE matched_invoice_id IS NOT NULL) AS qonto_matched,
      (SELECT count(*) FROM invoices) AS invoices_total,
      (SELECT count(*) FROM invoices WHERE invoice_number LIKE 'LEGACY-%') AS invoices_legacy,
      (SELECT count(*) FROM invoice_imports) AS imports_total,
      (SELECT count(*) FROM invoice_imports WHERE status = 'materialized') AS imports_materialized,
      (SELECT count(*) FROM clients) AS clients_total,
      (SELECT count(*) FROM products) AS products_total
  `);
  console.log(JSON.stringify(r.rows[0], null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
