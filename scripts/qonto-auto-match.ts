// Lance l'auto-match Qonto (mêmes règles que l'action server) :
// crédits → factures clients (totalTtc ±0.01€, ±90j, fuzzy nom)
// débits → factures fournisseurs (idem)
import { config } from "dotenv";
config({ path: ".env.local" });

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NAME_THRESHOLD = 0.5;
const TIE_MARGIN = 0.1;
const AMOUNT_TOL = 0.01;
const DATE_WINDOW_DAYS = 90;

// Le score est partagé avec l'action server pour cohérence : voir lib/text-match.ts

async function main() {
  const { and, eq, isNull } = await import("drizzle-orm");
  const { db, schema } = await import("../lib/db");
  const { nameMatchScore } = await import("../lib/text-match");

  const unmatched = await db
    .select({
      id: schema.qontoTransactions.id,
      amount: schema.qontoTransactions.amount,
      settledAt: schema.qontoTransactions.settledAt,
      date: schema.qontoTransactions.date,
      counterpartyName: schema.qontoTransactions.counterpartyName,
      label: schema.qontoTransactions.label,
    })
    .from(schema.qontoTransactions)
    .where(
      and(
        isNull(schema.qontoTransactions.matchedInvoiceId),
        isNull(schema.qontoTransactions.matchedSupplierInvoiceId),
      ),
    );

  const [clientInvs, supplierInvs] = await Promise.all([
    db
      .select({
        id: schema.invoices.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        issueDate: schema.invoices.issueDate,
        totalTtc: schema.invoices.totalTtc,
        clientSnapshot: schema.invoices.clientSnapshot,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.status, "issued")),
    db
      .select({
        id: schema.supplierInvoices.id,
        supplierInvoiceNumber: schema.supplierInvoices.supplierInvoiceNumber,
        issueDate: schema.supplierInvoices.issueDate,
        totalTtc: schema.supplierInvoices.totalTtc,
        supplierSnapshot: schema.supplierInvoices.supplierSnapshot,
      })
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.status, "issued")),
  ]);

  console.log(
    `${unmatched.length} txs non rapprochées · ${clientInvs.length} factures clients · ${supplierInvs.length} factures fournisseurs`,
  );

  let matched = 0;
  let ambiguous = 0;

  for (const tx of unmatched) {
    const amt = Number(tx.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const isCredit = amt > 0;
    const abs = Math.abs(amt);
    const refMs = (tx.settledAt ?? new Date(tx.date)).getTime();
    const fromMs = refMs - DATE_WINDOW_DAYS * ONE_DAY_MS;
    const toMs = refMs + DATE_WINDOW_DAYS * ONE_DAY_MS;
    const cp = tx.counterpartyName ?? tx.label ?? "";

    if (isCredit) {
      const cands = clientInvs
        .filter((inv) => {
          const t = Number(inv.totalTtc);
          if (!Number.isFinite(t) || Math.abs(t - abs) > AMOUNT_TOL) return false;
          const im = new Date(inv.issueDate).getTime();
          return im >= fromMs && im <= toMs;
        })
        .map((inv) => ({ inv, score: nameMatchScore(inv.clientSnapshot?.name ?? "", cp) }))
        .sort((a, b) => b.score - a.score);
      if (!cands.length || cands[0].score < NAME_THRESHOLD) continue;
      if (cands[1] && cands[1].score >= cands[0].score - TIE_MARGIN) {
        ambiguous++;
        continue;
      }
      await db
        .update(schema.qontoTransactions)
        .set({
          matchedInvoiceId: cands[0].inv.id,
          matchedAt: new Date(),
          matchNote: `Auto-match client (score nom ${cands[0].score.toFixed(2)})`,
        })
        .where(eq(schema.qontoTransactions.id, tx.id));
      matched++;
      console.log(
        `  ✓ ${cands[0].inv.invoiceNumber} ↔ ${tx.date} ${cp} ${abs}€`,
      );
    } else {
      const cands = supplierInvs
        .filter((si) => {
          const t = Number(si.totalTtc);
          if (!Number.isFinite(t) || Math.abs(t - abs) > AMOUNT_TOL) return false;
          const im = new Date(si.issueDate).getTime();
          return im >= fromMs && im <= toMs;
        })
        .map((si) => ({ si, score: nameMatchScore(si.supplierSnapshot?.name ?? "", cp) }))
        .sort((a, b) => b.score - a.score);
      if (!cands.length || cands[0].score < NAME_THRESHOLD) continue;
      if (cands[1] && cands[1].score >= cands[0].score - TIE_MARGIN) {
        ambiguous++;
        continue;
      }
      await db
        .update(schema.qontoTransactions)
        .set({
          matchedSupplierInvoiceId: cands[0].si.id,
          matchedAt: new Date(),
          matchNote: `Auto-match fournisseur (score nom ${cands[0].score.toFixed(2)})`,
        })
        .where(eq(schema.qontoTransactions.id, tx.id));
      matched++;
      console.log(
        `  ✓ ${cands[0].si.supplierInvoiceNumber} ↔ ${tx.date} ${cp} ${abs}€`,
      );
    }
  }

  console.log(`\n${matched} matchées, ${ambiguous} ambiguës.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
