// Sync local : exécute la même logique que l'action server syncQonto, sans requireAuth.
// Utile pour seeding initial sans devoir cliquer le bouton dans l'UI.
import { config } from "dotenv";
config({ path: ".env.local" });

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const { eq, max } = await import("drizzle-orm");
  const { db, schema } = await import("../lib/db");
  const { getOrganization, iterateTransactions, toQontoRow } = await import("../lib/qonto");

  const { organization } = await getOrganization();
  const accounts = organization.bank_accounts.filter((a) => a.status !== "closed");
  console.log(`${organization.legal_name} : ${accounts.length} compte(s) actif(s)`);

  const lastRow = await db
    .select({ max: max(schema.qontoTransactions.settledAt) })
    .from(schema.qontoTransactions);
  const lastSettled = lastRow[0]?.max ?? null;
  const fromDate = lastSettled
    ? new Date(lastSettled.getTime() - ONE_DAY_MS)
    : new Date(Date.now() - TWO_YEARS_MS);
  const sinceIso = fromDate.toISOString();
  console.log(`Sync depuis ${sinceIso}`);

  let newCount = 0;
  let updatedCount = 0;
  let skippedPending = 0;

  for (const account of accounts) {
    process.stdout.write(`  ${account.slug} : `);
    let pageNum = 0;
    for await (const batch of iterateTransactions({
      bankAccountId: account.id,
      settledAtFrom: sinceIso,
    })) {
      pageNum++;
      process.stdout.write(`p${pageNum}(${batch.length}) `);
      for (const tx of batch) {
        if (!tx.settled_at) {
          skippedPending++;
          continue;
        }
        const row = toQontoRow(tx);
        const existing = await db.query.qontoTransactions.findFirst({
          where: eq(schema.qontoTransactions.qontoId, row.qontoId),
        });
        if (existing) {
          await db
            .update(schema.qontoTransactions)
            .set(row)
            .where(eq(schema.qontoTransactions.id, existing.id));
          updatedCount++;
        } else {
          await db.insert(schema.qontoTransactions).values(row);
          newCount++;
        }
      }
    }
    process.stdout.write("\n");
  }

  console.log(
    `\nTerminé : ${newCount} créées, ${updatedCount} mises à jour, ${skippedPending} pending ignorées.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("ERREUR :", e instanceof Error ? e.message : e);
  process.exit(1);
});
