import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import {
  computeCompteResultatFormel,
  type CompteResultatRow,
} from "@/lib/bilan";
import { getExercicePeriod } from "@/lib/accounting";

type SP = Promise<{ exercice?: string }>;

const fmt = (n: number) =>
  Math.abs(n) < 0.005
    ? "—"
    : `${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

function defaultExercice(): string {
  return new Date().getUTCFullYear().toString();
}

function Row({ r }: { r: CompteResultatRow }) {
  const labelClass = r.isHeader
    ? "text-xs font-bold uppercase tracking-wide text-neutral-700"
    : r.isGrandTotal
      ? "text-sm font-bold uppercase"
      : r.isSubtotal
        ? "text-sm font-semibold pl-3"
        : "text-sm pl-3 text-neutral-700";
  const rowClass = r.isHeader
    ? "bg-neutral-100"
    : r.isGrandTotal
      ? "border-t-2 border-neutral-900 bg-neutral-50"
      : r.isSubtotal
        ? "border-t border-neutral-200 bg-neutral-50/50"
        : "";
  return (
    <tr className={rowClass}>
      <td className={`px-3 py-1.5 ${labelClass}`}>
        {r.label}
        {r.accountHint && !r.isHeader && !r.isSubtotal && !r.isGrandTotal ? (
          <span className="ml-2 font-mono text-[10px] text-neutral-400">
            ({r.accountHint})
          </span>
        ) : null}
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums ${
          r.isGrandTotal ? "text-sm font-bold" : "text-sm"
        }`}
      >
        {r.isHeader ? "" : fmt(r.amountN)}
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums text-sm ${
          r.isGrandTotal ? "font-semibold" : "text-neutral-500"
        }`}
      >
        {r.isHeader ? "" : fmt(r.amountN1)}
      </td>
    </tr>
  );
}

export default async function CompteResultatPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const exercice = sp.exercice ?? defaultExercice();
  const exYear = Number.parseInt(exercice, 10);

  const cr = await computeCompteResultatFormel(exYear);
  const period = await getExercicePeriod(exYear);
  const fmtFr = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

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
            / Compte de résultat
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            Compte de résultat — Exercice {exYear}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Lascia Corre Distribution — SAS au capital de 1 000 € — SIRET 422
            310 391 00046 — Période {fmtFr(period.startDate)} – {fmtFr(period.endDate)}.
          </p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            ⚠ <strong>Document non certifié.</strong> À valider par
            l'expert-comptable avant tout dépôt.
          </div>
        </div>
        <a
          href={`/api/accounting/compte-resultat/export?exercice=${exercice}&format=xlsx`}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:border-neutral-500"
        >
          Export XLSX
        </a>
      </div>

      <div className="mt-4 max-w-xs">
        <FilterSelect
          name="exercice"
          value={exercice}
          options={exerciceOptions}
          placeholder="Exercice"
          basePath="/accounting/compte-resultat"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 bg-neutral-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
            Charges
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-1.5 text-left font-medium">Rubrique</th>
                <th className="px-3 py-1.5 text-right font-medium">{exYear}</th>
                <th className="px-3 py-1.5 text-right font-medium">{exYear - 1}</th>
              </tr>
            </thead>
            <tbody>
              {cr.charges.map((r, i) => (
                <Row key={i} r={r} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 bg-neutral-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
            Produits
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-1.5 text-left font-medium">Rubrique</th>
                <th className="px-3 py-1.5 text-right font-medium">{exYear}</th>
                <th className="px-3 py-1.5 text-right font-medium">{exYear - 1}</th>
              </tr>
            </thead>
            <tbody>
              {cr.produits.map((r, i) => (
                <Row key={i} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Soldes intermédiaires */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Résultat d'exploitation", n: cr.resultatExploitationN, n1: cr.resultatExploitationN1 },
          { label: "Résultat financier", n: cr.resultatFinancierN, n1: cr.resultatFinancierN1 },
          { label: "Résultat exceptionnel", n: cr.resultatExceptionnelN, n1: cr.resultatExceptionnelN1 },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-neutral-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{s.label}</div>
            <div className={`mt-1 text-base font-semibold tabular-nums ${s.n >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {fmt(s.n)}
            </div>
            <div className="text-xs tabular-nums text-neutral-400">{exYear - 1} : {fmt(s.n1)}</div>
          </div>
        ))}
      </div>

      <div
        className={`mt-6 rounded-md border px-4 py-4 ${
          cr.resultatNetN > 0.01
            ? "border-emerald-300 bg-emerald-50 text-emerald-900"
            : cr.resultatNetN < -0.01
              ? "border-red-300 bg-red-50 text-red-900"
              : "border-neutral-200 bg-neutral-50 text-neutral-700"
        }`}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-base font-bold uppercase">
            Résultat net de l'exercice {cr.resultatNetN >= 0 ? "(bénéfice)" : "(perte)"}
          </span>
          <span className="text-xl font-bold tabular-nums">
            {fmt(cr.resultatNetN)}
          </span>
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {exYear - 1} : <span className="tabular-nums">{fmt(cr.resultatNetN1)}</span>
        </div>
      </div>
    </div>
  );
}
