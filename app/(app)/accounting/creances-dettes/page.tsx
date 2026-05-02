import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import {
  fetchOpenClientInvoices,
  fetchOpenSupplierInvoices,
  type OpenInvoice,
} from "@/lib/creances-dettes";

type SP = Promise<{ exercice?: string; closing?: string }>;

function defaultExercice(): string {
  return new Date().getUTCFullYear().toString();
}

const fmt = (n: number) =>
  n === 0 ? "—" : `${n.toFixed(2).replace(".", ",")} €`;

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function Table({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: OpenInvoice[];
  emptyText: string;
}) {
  const totalTtc = rows.reduce((s, r) => s + r.totalTtc, 0);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-neutral-600">
          {rows.length} facture{rows.length > 1 ? "s" : ""} ·{" "}
          <span className="font-medium tabular-nums text-neutral-900">
            {fmt(totalTtc)}
          </span>{" "}
          TTC
        </p>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">N° pièce</th>
              <th className="px-3 py-2 font-medium">Tiers</th>
              <th className="px-3 py-2 font-medium text-right">HT</th>
              <th className="px-3 py-2 font-medium text-right">TVA</th>
              <th className="px-3 py-2 font-medium text-right">TTC</th>
              <th className="px-3 py-2 font-medium">Échéance</th>
              <th className="px-3 py-2 font-medium text-right">Anc.</th>
              <th className="px-3 py-2 font-medium text-right">Retard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-neutral-500">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-xs tabular-nums text-neutral-600">
                    {fmtDate(r.date)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.number}</td>
                  <td className="px-3 py-2">{r.tierName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(r.totalHt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(r.totalVat)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmt(r.totalTtc)}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-neutral-600">
                    {fmtDate(r.dueDate)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-neutral-500">
                    {r.daysOld}j
                  </td>
                  <td
                    className={`px-3 py-2 text-right text-xs tabular-nums ${
                      r.daysOverdue && r.daysOverdue > 0
                        ? "font-medium text-red-700"
                        : "text-neutral-400"
                    }`}
                  >
                    {r.daysOverdue && r.daysOverdue > 0
                      ? `+${r.daysOverdue}j`
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function CreancesDettesPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const exercice = sp.exercice ?? defaultExercice();
  const closing = sp.closing ?? `${exercice}-12-31`;

  const [creances, dettes] = await Promise.all([
    fetchOpenClientInvoices(closing),
    fetchOpenSupplierInvoices(closing),
  ]);

  const exerciceOptions = ["2024", "2025", "2026"].map((y) => ({
    value: y,
    label: `Exercice ${y}`,
  }));

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-500">
            <Link href="/accounting" className="hover:underline">
              Comptabilité
            </Link>{" "}
            / Créances & dettes
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            Créances & dettes au {fmtDate(closing)}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Source : factures dont le status n'est pas <code>paid</code>. Le
            lettrage via le module Banque fait foi.
          </p>
        </div>
        <a
          href={`/api/accounting/creances-dettes/export?exercice=${exercice}&closing=${closing}&format=xlsx`}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:border-neutral-500"
        >
          Export XLSX
        </a>
      </div>

      <div className="mt-6 max-w-xs">
        <FilterSelect
          name="exercice"
          value={exercice}
          options={exerciceOptions}
          placeholder="Exercice"
          basePath="/accounting/creances-dettes"
        />
      </div>

      <div className="mt-8 space-y-10">
        <Table
          title="Créances clients (411 — factures non encaissées)"
          rows={creances}
          emptyText="Aucune créance ouverte au 31/12."
        />
        <Table
          title="Dettes fournisseurs (401 — factures non payées)"
          rows={dettes}
          emptyText="Aucune dette ouverte au 31/12."
        />
      </div>
    </div>
  );
}
