// Inspecte les transactions Qonto-fee dans notre DB pour voir si elles
// contiennent un attachment_id (= la facture Qonto en PDF).
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db, schema } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");

  const fees = await db
    .select()
    .from(schema.qontoTransactions)
    .where(sql`${schema.qontoTransactions.label} ILIKE 'Qonto%'`);

  console.log(`${fees.length} transactions 'Qonto'`);
  for (const f of fees.slice(0, 3)) {
    const raw = f.rawJson as Record<string, unknown> | null;
    console.log(`\n${f.date} | ${f.label} | ${f.amount}€`);
    console.log(
      "  operation_type:",
      raw?.operation_type,
      "| subject_type:",
      raw?.subject_type,
    );
    console.log("  attachment_ids:", raw?.attachment_ids);
    console.log("  reference:", raw?.reference);
    console.log("  category:", raw?.cashflow_category);
  }

  // Voyons combien ont des attachments
  let withAtt = 0;
  for (const f of fees) {
    const raw = f.rawJson as Record<string, unknown> | null;
    const ids = raw?.attachment_ids as string[] | undefined;
    if (ids && ids.length > 0) withAtt++;
  }
  console.log(
    `\n${withAtt} sur ${fees.length} ont des attachment_ids présents.`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
