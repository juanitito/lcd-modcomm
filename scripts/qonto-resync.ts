// Re-sync FULL Qonto sur 2 ans, en rafraîchissant les rawJson (donc
// les attachment_ids) sans écraser les matched_* déjà posés.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("../lib/db");
  const { getOrganization, iterateTransactions, toQontoRow } = await import(
    "../lib/qonto"
  );

  const { organization } = await getOrganization();
  const accounts = organization.bank_accounts.filter(
    (a) => a.status !== "closed",
  );
  const since = new Date(Date.now() - 2 * 365 * 86400000).toISOString();

  let refreshed = 0;
  let inserted = 0;
  for (const account of accounts) {
    for await (const batch of iterateTransactions({
      bankAccountId: account.id,
      settledAtFrom: since,
    })) {
      for (const tx of batch) {
        if (!tx.settled_at) continue;
        const row = toQontoRow(tx);
        const existing = await db.query.qontoTransactions.findFirst({
          where: eq(schema.qontoTransactions.qontoId, row.qontoId),
        });
        if (existing) {
          await db
            .update(schema.qontoTransactions)
            .set({
              counterpartyName: row.counterpartyName,
              qontoCategory: row.qontoCategory,
              rawJson: row.rawJson,
            })
            .where(eq(schema.qontoTransactions.id, existing.id));
          refreshed++;
        } else {
          await db.insert(schema.qontoTransactions).values(row);
          inserted++;
        }
      }
    }
  }
  console.log(`${refreshed} rafraîchies, ${inserted} nouvelles`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
