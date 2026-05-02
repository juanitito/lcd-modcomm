import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import { computeBilanFormel, type BilanRow } from "@/lib/bilan";

type SP = Promise<{ exercice?: string }>;

const fmt = (n: number) =>
  Math.abs(n) < 0.005
    ? "—"
    : `${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function defaultExercice(): string {
  return new Date().getUTCFullYear().toString();
}

function Row({ r }: { r: BilanRow }) {
  const labelClass =
    r.level === 0 && r.isHeader
      ? "text-xs font-bold uppercase tracking-wide text-neutral-700"
      : r.isGrandTotal
        ? "text-sm font-bold uppercase"
        : r.isSubtotal
          ? "text-sm font-semibold pl-3"
          : r.level === 1
            ? "text-sm pl-3 text-neutral-700"
            : "text-xs pl-6 text-neutral-500";
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
        {r.isHeader ? "" : fmt(r.netN)}
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums text-sm ${
          r.isGrandTotal ? "font-semibold" : "text-neutral-500"
        }`}
      >
        {r.isHeader ? "" : fmt(r.netN1)}
      </td>
    </tr>
  );
}

export default async function PreBilanPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const exercice = sp.exercice ?? defaultExercice();
  const exYear = Number.parseInt(exercice, 10);

  const bilan = await computeBilanFormel(exYear);
  const ecart = bilan.totalActifN - bilan.totalPassifN;

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
            / Pré-bilan
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            Pré-bilan au {fmtDate(bilan.closingDate)}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Lascia Corre Distribution — SAS au capital de 1 000 € — SIRET 422
            310 391 00046
          </p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            ⚠ <strong>PRÉ-BILAN — document non certifié.</strong> À valider
            par l'expert-comptable avant tout dépôt légal.
          </div>
        </div>
        <a
          href={`/api/accounting/pre-bilan/export?exercice=${exercice}&format=xlsx`}
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
          basePath="/accounting/pre-bilan"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 bg-neutral-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
            Actif
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-1.5 text-left font-medium">Rubrique</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Net {exYear}
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Net {exYear - 1}
                </th>
              </tr>
            </thead>
            <tbody>
              {bilan.actif.map((r, i) => (
                <Row key={i} r={r} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 bg-neutral-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
            Passif
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-1.5 text-left font-medium">Rubrique</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Net {exYear}
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Net {exYear - 1}
                </th>
              </tr>
            </thead>
            <tbody>
              {bilan.passif.map((r, i) => (
                <Row key={i} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className={`mt-6 rounded-md border px-4 py-3 text-sm ${
          Math.abs(ecart) < 0.01
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        {Math.abs(ecart) < 0.01 ? (
          <span>✓ Bilan équilibré (Actif = Passif).</span>
        ) : (
          <span>
            ⚠ Écart Actif − Passif :{" "}
            <span className="font-semibold tabular-nums">{fmt(ecart)}</span>.
            Causes possibles : charges sociales non saisies, IS non provisionné,
            écritures d'inventaire manquantes, immobilisations non comptabilisées.
            À examiner avec l'expert-comptable.
          </span>
        )}
      </div>
    </div>
  );
}
