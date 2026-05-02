import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db, schema } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");

  const sup = await db.select().from(schema.suppliers);
  console.log(`Fournisseurs en DB : ${sup.length}`);
  for (const s of sup) {
    console.log(`  - ${s.code} | ${s.name} | siret=${s.siret ?? "—"} | active=${s.active}`);
  }

  const counts = await db.execute(sql`
    SELECT
      coalesce(s.code, '(null)') AS code,
      coalesce(s.name, '(null)') AS name,
      count(p.id) AS products
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    GROUP BY s.code, s.name
    ORDER BY products DESC
  `);
  console.log(`\nRépartition produits par fournisseur :`);
  for (const r of counts.rows) console.log(`  ${r.code} (${r.name}) : ${r.products}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
