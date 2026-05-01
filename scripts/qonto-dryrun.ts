// Dry-run : appelle l'API Qonto sans écrire en DB.
// Vérifie : auth, liste comptes, première page de transactions, signature des montants.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getOrganization, listTransactionsPage, toQontoRow } = await import(
    "../lib/qonto"
  );

  const { organization } = await getOrganization();
  console.log(`Org : ${organization.legal_name} (${organization.slug})`);
  console.log(`Comptes bancaires : ${organization.bank_accounts.length}`);
  for (const acc of organization.bank_accounts) {
    console.log(
      `  - ${acc.slug} | balance ${acc.balance}${acc.currency} | status ${acc.status}${acc.main ? " | main" : ""}`,
    );
  }

  const main_acc = organization.bank_accounts.find((a) => a.main) ?? organization.bank_accounts[0];
  if (!main_acc) {
    console.log("Pas de compte principal trouvé.");
    return;
  }

  // Fenêtre 2 ans
  const since = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
  console.log(`\nFetching transactions depuis ${since.slice(0, 10)} sur ${main_acc.slug}…`);

  const r = await listTransactionsPage({
    bankAccountId: main_acc.id,
    settledAtFrom: since,
    perPage: 100,
    page: 1,
  });

  console.log(`Page 1/${r.meta.total_pages} : ${r.transactions.length} transactions sur ${r.meta.total_count} total`);

  let credits = 0;
  let debits = 0;
  let totalCredit = 0;
  let totalDebit = 0;
  const sample: { date: string; label: string; amount: string }[] = [];

  for (const tx of r.transactions) {
    const row = toQontoRow(tx);
    const amount = Number(row.amount);
    if (amount > 0) {
      credits++;
      totalCredit += amount;
    } else {
      debits++;
      totalDebit += amount;
    }
    if (sample.length < 5) {
      sample.push({
        date: row.date,
        label: row.counterpartyName?.slice(0, 40) ?? "—",
        amount: amount.toFixed(2),
      });
    }
  }

  console.log(`\nSur cette page :`);
  console.log(`  ${credits} crédits, total ${totalCredit.toFixed(2)}€`);
  console.log(`  ${debits} débits, total ${totalDebit.toFixed(2)}€`);
  console.log(`\nÉchantillon :`);
  for (const s of sample) {
    console.log(`  ${s.date} | ${s.label.padEnd(40)} | ${s.amount.padStart(10)}€`);
  }

  // Estimation totale
  const estimatedTotal = r.meta.total_count;
  console.log(
    `\nVolume total estimé sur 2 ans : ${estimatedTotal} transactions (~${Math.ceil(estimatedTotal / 100)} pages).`,
  );
}

main().catch((e) => {
  console.error("ERREUR :", e instanceof Error ? e.message : e);
  process.exit(1);
});
