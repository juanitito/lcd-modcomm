import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import { computeCompteResultat, type CompteResultatLine } from "@/lib/bilan";

type SP = Promise<{ exercice?: string }>;

const fmt = (n: number) =>
  `${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

function defaultExercice(): string {
  return new Date().getUTCFullYear().toString();
}

function Lines({
  title,
  lines,
  total,
}: {
  title: string;
  lines: CompteResultatLine[];
  total: number;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      <div className="mt-2 space-y-1">
        {lines.length === 0 ? (
          <p className="text-xs italic text-neutral-400">Néant</p>
        ) : (
          lines.map((l) => (
            <div key={l.accountCode} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-neutral-700">
                <span className="font-mono text-[11px] text-neutral-400">
                  {l.accountCode}
                </span>{" "}
                {l.label}
              </span>
              <span className="tabular-nums">{fmt(l.amount)}</span>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-neutral-300 pt-2 text-sm font-semibold">
        <span>Sous-total</span>
        <span className="tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  );
}

export default async function CompteResultatPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const exercice = sp.exercice ?? defaultExercice();
  const fromDate = `${exercice}-01-01`;
  const toDate = `${exercice}-12-31`;

  const cr = await computeCompteResultat(fromDate, toDate);

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
            Compte de résultat — {exercice}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Période 01/01/{exercice} – 31/12/{exercice}. Calculé depuis le
            grand livre, classes 6 (charges) et 7 (produits).
          </p>
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

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Charges</h2>
          <div className="mt-4">
            <Lines title="Charges" lines={cr.chargesLines} total={cr.charges} />
          </div>
          <div className="mt-6 flex items-baseline justify-between border-t-2 border-neutral-900 pt-3 text-base font-bold">
            <span>Total charges</span>
            <span className="tabular-nums">{fmt(cr.charges)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Produits</h2>
          <div className="mt-4">
            <Lines title="Produits" lines={cr.produitsLines} total={cr.produits} />
          </div>
          <div className="mt-6 flex items-baseline justify-between border-t-2 border-neutral-900 pt-3 text-base font-bold">
            <span>Total produits</span>
            <span className="tabular-nums">{fmt(cr.produits)}</span>
          </div>
        </div>
      </div>

      <div
        className={`mt-6 rounded-md border px-4 py-3 text-base font-semibold ${
          cr.resultat > 0.01
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : cr.resultat < -0.01
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-neutral-200 bg-neutral-50 text-neutral-700"
        }`}
      >
        <div className="flex items-baseline justify-between">
          <span>
            {cr.resultat > 0.01
              ? "Bénéfice"
              : cr.resultat < -0.01
                ? "Perte"
                : "Résultat nul"}
          </span>
          <span className="tabular-nums">{fmt(cr.resultat)}</span>
        </div>
      </div>
    </div>
  );
}
