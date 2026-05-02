import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");

  const r = await db.execute(sql`
    SELECT direction, status, count(*) AS n
    FROM invoice_imports
    GROUP BY direction, status
    ORDER BY direction, status
  `);
  console.log("=== invoice_imports par direction × status ===");
  for (const row of r.rows) console.log(" ", row);

  const sup = await db.execute(sql`
    SELECT
      coalesce(s.name, '(non matché)') AS supplier,
      ii.status,
      ii.extracted->>'legacyNumber' AS num,
      ii.extracted->>'issueDate' AS date,
      (ii.extracted->'totals'->>'totalTtc')::numeric AS ttc,
      ii.extracted->'clientGuess'->>'name' AS guess_name,
      ii.extracted->'clientGuess'->>'siret' AS guess_siret,
      ii.error_message
    FROM invoice_imports ii
    LEFT JOIN suppliers s ON s.id = ii.matched_supplier_id
    WHERE ii.direction = 'supplier'
    ORDER BY ii.created_at DESC
  `);
  console.log("\n=== imports fournisseurs ===");
  for (const row of sup.rows) {
    console.log(
      `  [${row.status}] ${row.num ?? "(no#)"} | ${row.date ?? "?"} | ${row.ttc ?? "?"}€ | matched=${row.supplier} | LLM-guess=${row.guess_name ?? "?"} (siret ${row.guess_siret ?? "—"})${row.error_message ? " | err=" + String(row.error_message).slice(0, 80) : ""}`,
    );
  }

  const mats = await db.execute(sql`
    SELECT count(*) AS n, coalesce(sum(total_ttc), 0) AS total
    FROM supplier_invoices
  `);
  console.log("\n=== supplier_invoices matérialisées ===");
  console.log(" ", mats.rows[0]);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
