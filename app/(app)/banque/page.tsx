import { and, asc, count, desc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { FilterSelect } from "@/components/filter-select";
import { SyncButtons } from "./_components/sync-buttons";
import { TransactionRow } from "./_components/transaction-row";

type SP = Promise<{
  match?: "matched" | "unmatched";
  side?: "income" | "expense";
}>;

const PAGE_LIMIT = 200;

export default async function BanquePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const matchFilter = sp.match;
  const sideFilter = sp.side;

  const matchCond =
    matchFilter === "matched"
      ? or(
          isNotNull(schema.qontoTransactions.matchedInvoiceId),
          isNotNull(schema.qontoTransactions.matchedSupplierInvoiceId),
        )
      : matchFilter === "unmatched"
        ? and(
            isNull(schema.qontoTransactions.matchedInvoiceId),
            isNull(schema.qontoTransactions.matchedSupplierInvoiceId),
          )
        : undefined;

  const sideCond =
    sideFilter === "income"
      ? sql`${schema.qontoTransactions.amount}::numeric > 0`
      : sideFilter === "expense"
        ? sql`${schema.qontoTransactions.amount}::numeric < 0`
        : undefined;

  const where = and(matchCond, sideCond);

  const [
    [{ total }],
    [{ totalMatched }],
    [{ totalIncome }],
    [{ totalExpense }],
  ] = await Promise.all([
    db.select({ total: count() }).from(schema.qontoTransactions),
    db
      .select({ totalMatched: count() })
      .from(schema.qontoTransactions)
      .where(
        or(
          isNotNull(schema.qontoTransactions.matchedInvoiceId),
          isNotNull(schema.qontoTransactions.matchedSupplierInvoiceId),
        ),
      ),
    db
      .select({ totalIncome: count() })
      .from(schema.qontoTransactions)
      .where(gt(sql`${schema.qontoTransactions.amount}::numeric`, sql`0`)),
    db
      .select({ totalExpense: count() })
      .from(schema.qontoTransactions)
      .where(lt(sql`${schema.qontoTransactions.amount}::numeric`, sql`0`)),
  ]);

  const transactions = await db
    .select({
      id: schema.qontoTransactions.id,
      date: schema.qontoTransactions.date,
      settledAt: schema.qontoTransactions.settledAt,
      amount: schema.qontoTransactions.amount,
      currency: schema.qontoTransactions.currency,
      label: schema.qontoTransactions.label,
      counterpartyName: schema.qontoTransactions.counterpartyName,
      qontoCategory: schema.qontoTransactions.qontoCategory,
      matchedInvoiceId: schema.qontoTransactions.matchedInvoiceId,
      matchedSupplierInvoiceId: schema.qontoTransactions.matchedSupplierInvoiceId,
      matchedAt: schema.qontoTransactions.matchedAt,
      matchNote: schema.qontoTransactions.matchNote,
      matchedInvoiceNumber: schema.invoices.invoiceNumber,
      matchedInvoiceTotal: schema.invoices.totalTtc,
      matchedSupplierInvoiceNumber: schema.supplierInvoices.supplierInvoiceNumber,
      matchedSupplierInvoiceTotal: schema.supplierInvoices.totalTtc,
    })
    .from(schema.qontoTransactions)
    .leftJoin(
      schema.invoices,
      eq(schema.qontoTransactions.matchedInvoiceId, schema.invoices.id),
    )
    .leftJoin(
      schema.supplierInvoices,
      eq(
        schema.qontoTransactions.matchedSupplierInvoiceId,
        schema.supplierInvoices.id,
      ),
    )
    .where(where)
    .orderBy(desc(schema.qontoTransactions.settledAt))
    .limit(PAGE_LIMIT);

  const [invoiceOptions, supplierInvoiceOptions] = await Promise.all([
    db
      .select({
        id: schema.invoices.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        totalTtc: schema.invoices.totalTtc,
        issueDate: schema.invoices.issueDate,
        clientSnapshot: schema.invoices.clientSnapshot,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.status, "issued"))
      .orderBy(asc(schema.invoices.invoiceNumber)),
    db
      .select({
        id: schema.supplierInvoices.id,
        supplierInvoiceNumber: schema.supplierInvoices.supplierInvoiceNumber,
        totalTtc: schema.supplierInvoices.totalTtc,
        issueDate: schema.supplierInvoices.issueDate,
        supplierSnapshot: schema.supplierInvoices.supplierSnapshot,
      })
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.status, "issued"))
      .orderBy(asc(schema.supplierInvoices.issueDate)),
  ]);

  const invoiceOptionsForUI = invoiceOptions.map((inv) => ({
    id: inv.id,
    label: `${inv.invoiceNumber} — ${inv.clientSnapshot?.name ?? "?"} — ${Number(inv.totalTtc).toFixed(2)}€ — ${inv.issueDate}`,
  }));

  const supplierInvoiceOptionsForUI = supplierInvoiceOptions.map((si) => ({
    id: si.id,
    label: `${si.supplierInvoiceNumber} — ${si.supplierSnapshot?.name ?? "?"} — ${Number(si.totalTtc).toFixed(2)}€ — ${si.issueDate}`,
  }));

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Banque (Qonto)</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {total} opération{total > 1 ? "s" : ""} synchronisées · {totalMatched}{" "}
            rapprochées · {totalIncome} crédits · {totalExpense} débits.
          </p>
        </div>
        <SyncButtons />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <FilterSelect
          name="match"
          value={matchFilter ?? ""}
          options={[
            { value: "unmatched", label: "Non rapprochées" },
            { value: "matched", label: "Rapprochées" },
          ]}
          placeholder="Toutes (rapproché)"
          basePath="/banque"
        />
        <FilterSelect
          name="side"
          value={sideFilter ?? ""}
          options={[
            { value: "income", label: "Crédits (income)" },
            { value: "expense", label: "Débits (expense)" },
          ]}
          placeholder="Tous (sens)"
          basePath="/banque"
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Contrepartie</th>
              <th className="px-3 py-2 font-medium">Catégorie</th>
              <th className="px-3 py-2 font-medium text-right">Montant</th>
              <th className="px-3 py-2 font-medium">Rapprochement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-neutral-500">
                  {total === 0
                    ? "Aucune opération. Synchronise depuis Qonto pour commencer."
                    : "Aucune opération ne correspond à ces filtres."}
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={{
                    id: tx.id,
                    date: tx.date,
                    settledAt: tx.settledAt
                      ? tx.settledAt.toISOString()
                      : null,
                    amount: tx.amount,
                    currency: tx.currency,
                    label: tx.label,
                    counterpartyName: tx.counterpartyName,
                    qontoCategory: tx.qontoCategory,
                    matchedInvoiceId: tx.matchedInvoiceId,
                    matchedInvoiceNumber: tx.matchedInvoiceNumber,
                    matchedInvoiceTotal: tx.matchedInvoiceTotal,
                    matchedSupplierInvoiceId: tx.matchedSupplierInvoiceId,
                    matchedSupplierInvoiceNumber: tx.matchedSupplierInvoiceNumber,
                    matchedSupplierInvoiceTotal: tx.matchedSupplierInvoiceTotal,
                    matchNote: tx.matchNote,
                  }}
                  invoiceOptions={invoiceOptionsForUI}
                  supplierInvoiceOptions={supplierInvoiceOptionsForUI}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_LIMIT ? (
        <p className="mt-3 text-xs text-neutral-500">
          Affichage limité aux {PAGE_LIMIT} opérations les plus récentes.
        </p>
      ) : null}
    </div>
  );
}
