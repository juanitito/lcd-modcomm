import Link from "next/link";
import { and, asc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { FilterSelect } from "@/components/filter-select";
import { ExportButtons } from "./_components/export-buttons";

type SP = Promise<{
  account?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  q?: string;
  exercice?: string; // YYYY
}>;

function defaultExercice(): string {
  const today = new Date();
  return today.getUTCFullYear().toString();
}

export default async function GrandLivrePage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const exercice = sp.exercice ?? defaultExercice();
  const fromDate = sp.from ?? `${exercice}-01-01`;
  const toDate = sp.to ?? `${exercice}-12-31`;
  const accountFilter = sp.account ?? "";
  const search = sp.q ?? "";

  // Tous les comptes utilisés (pour le picker)
  const accountsUsed = await db
    .selectDistinct({ accountCode: schema.journalLines.accountCode })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      eq(schema.journalLines.entryId, schema.journalEntries.id),
    )
    .where(
      and(
        gte(schema.journalEntries.date, fromDate),
        lte(schema.journalEntries.date, toDate),
      ),
    )
    .orderBy(asc(schema.journalLines.accountCode));

  const accountLabels = await db.query.chartOfAccounts.findMany({
    columns: { code: true, label: true },
  });
  const labelByCode = new Map(accountLabels.map((a) => [a.code, a.label]));

  // Lignes filtrées
  const conditions = [
    gte(schema.journalEntries.date, fromDate),
    lte(schema.journalEntries.date, toDate),
  ];
  if (accountFilter) {
    conditions.push(eq(schema.journalLines.accountCode, accountFilter));
  }
  if (search) {
    conditions.push(
      or(
        ilike(schema.journalLines.label, `%${search}%`),
        ilike(schema.journalEntries.entryNumber, `%${search}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      date: schema.journalEntries.date,
      entryNumber: schema.journalEntries.entryNumber,
      journal: schema.journalEntries.journal,
      label: schema.journalLines.label,
      accountCode: schema.journalLines.accountCode,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      eq(schema.journalLines.entryId, schema.journalEntries.id),
    )
    .where(and(...conditions))
    .orderBy(
      asc(schema.journalEntries.date),
      asc(schema.journalEntries.entryNumber),
      asc(schema.journalLines.position),
    );

  const totDebit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totCredit = rows.reduce((s, r) => s + Number(r.credit), 0);

  // Solde cumulé (uniquement quand un compte est sélectionné)
  let runningBalance = 0;
  const rowsWithBalance = rows.map((r) => {
    if (accountFilter) {
      runningBalance += Number(r.debit) - Number(r.credit);
      return { ...r, balance: runningBalance };
    }
    return { ...r, balance: null as number | null };
  });

  const accountOptions = accountsUsed.map((a) => ({
    value: a.accountCode,
    label: `${a.accountCode} — ${labelByCode.get(a.accountCode) ?? "?"}`,
  }));

  // Liste des exercices disponibles (basée sur les dates des écritures)
  const periods = await db.query.accountingPeriods.findMany({
    orderBy: asc(schema.accountingPeriods.startDate),
  });
  const exerciceOptions = periods.map((p) => {
    const year = p.startDate.slice(0, 4);
    return { value: year, label: `${p.label} (${year})` };
  });

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-500">
            <Link href="/accounting" className="hover:underline">
              Comptabilité
            </Link>{" "}
            / Grand livre
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Grand livre — {exercice}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {rows.length} ligne{rows.length > 1 ? "s" : ""} · Total Débit{" "}
            <span className="tabular-nums font-medium text-neutral-800">
              {totDebit.toFixed(2)} €
            </span>{" "}
            / Crédit{" "}
            <span className="tabular-nums font-medium text-neutral-800">
              {totCredit.toFixed(2)} €
            </span>
            {Math.abs(totDebit - totCredit) > 0.01 ? (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                ⚠ déséquilibre {(totDebit - totCredit).toFixed(2)} €
              </span>
            ) : null}
          </p>
        </div>
        <ExportButtons
          params={{ account: accountFilter, from: fromDate, to: toDate, q: search }}
        />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <FilterSelect
          name="exercice"
          value={exercice}
          options={exerciceOptions.length > 0 ? exerciceOptions : [
            { value: defaultExercice(), label: `Exercice ${defaultExercice()}` },
          ]}
          placeholder="Exercice"
          basePath="/accounting/grand-livre"
        />
        <FilterSelect
          name="account"
          value={accountFilter}
          options={accountOptions}
          placeholder="Tous les comptes"
          basePath="/accounting/grand-livre"
        />
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Recherche libellé / pièce"
          className="input text-sm"
          form="grand-livre-search"
        />
        <form
          id="grand-livre-search"
          action="/accounting/grand-livre"
          method="get"
          className="flex gap-2"
        >
          {accountFilter ? (
            <input type="hidden" name="account" value={accountFilter} />
          ) : null}
          <input type="hidden" name="exercice" value={exercice} />
          <button
            type="submit"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-500"
          >
            Filtrer
          </button>
        </form>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Pièce</th>
              <th className="px-3 py-2 font-medium">Jrnl</th>
              <th className="px-3 py-2 font-medium">Libellé</th>
              <th className="px-3 py-2 font-medium">Compte</th>
              <th className="px-3 py-2 font-medium text-right">Débit</th>
              <th className="px-3 py-2 font-medium text-right">Crédit</th>
              {accountFilter ? (
                <th className="px-3 py-2 font-medium text-right">Solde cumulé</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rowsWithBalance.length === 0 ? (
              <tr>
                <td
                  colSpan={accountFilter ? 8 : 7}
                  className="px-3 py-8 text-center text-neutral-500"
                >
                  Aucune écriture pour ces filtres.
                </td>
              </tr>
            ) : (
              rowsWithBalance.map((r, i) => (
                <tr key={i} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 text-xs tabular-nums text-neutral-600">
                    {r.date}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.entryNumber}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{r.journal}</td>
                  <td className="px-3 py-2 text-xs">{r.label}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.accountCode}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(r.debit) > 0 ? `${Number(r.debit).toFixed(2)} €` : ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(r.credit) > 0 ? `${Number(r.credit).toFixed(2)} €` : ""}
                  </td>
                  {accountFilter ? (
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.balance != null && r.balance < 0
                          ? "text-red-700"
                          : "text-neutral-800"
                      }`}
                    >
                      {r.balance != null ? `${r.balance.toFixed(2)} €` : ""}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
