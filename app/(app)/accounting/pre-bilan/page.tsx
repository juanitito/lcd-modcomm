import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import { computeBilan, type BilanLine } from "@/lib/bilan";

type SP = Promise<{ exercice?: string }>;

const fmt = (n: number) =>
  `${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function defaultExercice(): string {
  return new Date().getUTCFullYear().toString();
}

function Block({
  title,
  lines,
  total,
}: {
  title: string;
  lines: BilanLine[];
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
          lines.map((l, i) => (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-neutral-700">
                  {l.label}
                  {l.accountCode ? (
                    <span className="ml-1 font-mono text-[10px] text-neutral-400">
                      ({l.accountCode})
                    </span>
                  ) : null}
                </span>
                <span className={`tabular-nums ${l.amount < 0 ? "text-red-700" : ""}`}>
                  {fmt(l.amount)}
                </span>
              </div>
              {l.detail && l.detail.length > 0 ? (
                <div className="ml-3 mt-1 space-y-0.5 border-l border-neutral-200 pl-3 text-xs text-neutral-500">
                  {l.detail.map((d) => (
                    <div key={d.code} className="flex justify-between gap-3">
                      <span className="font-mono">{d.code}</span>
                      <span className="tabular-nums">{fmt(d.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
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

export default async function PreBilanPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const exercice = sp.exercice ?? defaultExercice();
  const closing = `${exercice}-12-31`;

  const bilan = await computeBilan(closing);

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
            Pré-bilan au {fmtDate(closing)}
          </h1>
          <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
            ⚠ <strong>PRÉ-BILAN — document non certifié.</strong> À valider par
            l'expert-comptable avant tout dépôt.
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

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Actif</h2>
          <div className="mt-4 space-y-6">
            <Block
              title="Actif circulant"
              lines={bilan.actif.circulant}
              total={bilan.actif.circulant.reduce((s, l) => s + l.amount, 0)}
            />
            <Block
              title="Immobilisations"
              lines={bilan.actif.immobilisations}
              total={0}
            />
          </div>
          <div className="mt-6 flex items-baseline justify-between border-t-2 border-neutral-900 pt-3 text-base font-bold">
            <span>Total actif</span>
            <span className="tabular-nums">{fmt(bilan.actif.total)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Passif</h2>
          <div className="mt-4 space-y-6">
            <Block
              title="Capitaux propres"
              lines={bilan.passif.capitauxPropres}
              total={bilan.passif.capitauxPropres.reduce(
                (s, l) => s + l.amount,
                0,
              )}
            />
            <Block
              title="Dettes"
              lines={bilan.passif.dettes}
              total={bilan.passif.dettes.reduce((s, l) => s + l.amount, 0)}
            />
          </div>
          <div className="mt-6 flex items-baseline justify-between border-t-2 border-neutral-900 pt-3 text-base font-bold">
            <span>Total passif</span>
            <span className="tabular-nums">{fmt(bilan.passif.total)}</span>
          </div>
        </div>
      </div>

      <div
        className={`mt-6 rounded-md border px-4 py-3 text-sm ${
          Math.abs(bilan.ecart) < 0.01
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        {Math.abs(bilan.ecart) < 0.01 ? (
          <>✓ Bilan équilibré.</>
        ) : (
          <>
            ⚠ Écart Actif − Passif :{" "}
            <span className="font-semibold tabular-nums">
              {fmt(bilan.ecart)}
            </span>
            . Probable cause : opérations comptables hors du cadre couvert
            (charges sociales non saisies, immobilisations, etc.). À examiner
            avec le comptable.
          </>
        )}
      </div>
    </div>
  );
}
