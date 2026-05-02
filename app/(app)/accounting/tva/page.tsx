import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import { computeTvaForYear, distinctRates } from "@/lib/tva";

type SP = Promise<{ exercice?: string }>;

function defaultExercice(): string {
  return new Date().getUTCFullYear().toString();
}

export default async function TvaPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const exercice = sp.exercice ?? defaultExercice();
  const year = Number.parseInt(exercice, 10);

  const { months, yearly } = await computeTvaForYear(year);
  const rates = distinctRates(months);
  const ratesPretty = rates.map((r) =>
    Number.isInteger(Number(r))
      ? `${Number(r)} %`
      : `${Number(r).toString().replace(".", ",")} %`,
  );

  const exerciceOptions = ["2024", "2025", "2026"].map((y) => ({
    value: y,
    label: `Exercice ${y}`,
  }));

  const fmt = (n: number) =>
    n === 0 ? "—" : `${n.toFixed(2).replace(".", ",")} €`;

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-500">
            <Link href="/accounting" className="hover:underline">
              Comptabilité
            </Link>{" "}
            / TVA
          </p>
          <h1 className="mt-1 text-2xl font-semibold">TVA — {exercice}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Ventilation par mois × taux. LCD applique 20 % à toutes ses
            ventes. Lecture du taux par ligne de facture (vatBreakdown) — la
            structure supporte d'autres taux si une facture les contient.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/accounting/tva/export?exercice=${exercice}&format=xlsx`}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:border-neutral-500"
          >
            Export XLSX (ventilation)
          </a>
          <a
            href={`/api/accounting/tva/export?exercice=${exercice}&format=ca3`}
            className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:border-blue-500"
            title="Fichier d'aide au remplissage des CA3 mensuelles sur impots.gouv.fr"
          >
            Aide CA3 (exercice)
          </a>
        </div>
      </div>

      <div className="mt-6 max-w-xs">
        <FilterSelect
          name="exercice"
          value={exercice}
          options={exerciceOptions}
          placeholder="Exercice"
          basePath="/accounting/tva"
        />
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium" rowSpan={2}>
                Mois
              </th>
              <th
                className="px-3 py-2 font-medium text-center border-l"
                colSpan={rates.length + 1}
              >
                TVA collectée
              </th>
              <th
                className="px-3 py-2 font-medium text-center border-l"
                colSpan={rates.length + 1}
              >
                TVA déductible
              </th>
              <th className="px-3 py-2 font-medium text-right border-l" rowSpan={2}>
                Net
              </th>
            </tr>
            <tr className="bg-neutral-50 text-[10px]">
              {rates.map((r, i) => (
                <th key={"c-" + r} className={`px-3 py-1 font-medium text-right ${i === 0 ? "border-l" : ""}`}>
                  {ratesPretty[i]}
                </th>
              ))}
              <th className="px-3 py-1 font-medium text-right">Total</th>
              {rates.map((r, i) => (
                <th key={"d-" + r} className={`px-3 py-1 font-medium text-right ${i === 0 ? "border-l" : ""}`}>
                  {ratesPretty[i]}
                </th>
              ))}
              <th className="px-3 py-1 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {months.map((m) => {
              const isEmpty =
                m.collectedTotal === 0 && m.deductibleTotal === 0;
              return (
                <tr key={m.monthKey} className={isEmpty ? "text-neutral-400" : ""}>
                  <td className="px-3 py-2">{m.monthLabel}</td>
                  {rates.map((r, i) => (
                    <td
                      key={"c-" + r}
                      className={`px-3 py-2 text-right tabular-nums ${i === 0 ? "border-l" : ""}`}
                    >
                      {fmt(m.collected[r] ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmt(m.collectedTotal)}
                  </td>
                  {rates.map((r, i) => (
                    <td
                      key={"d-" + r}
                      className={`px-3 py-2 text-right tabular-nums ${i === 0 ? "border-l" : ""}`}
                    >
                      {fmt(m.deductible[r] ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmt(m.deductibleTotal)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-semibold border-l ${
                      m.net > 0.01
                        ? "text-red-700"
                        : m.net < -0.01
                          ? "text-emerald-700"
                          : "text-neutral-400"
                    }`}
                  >
                    {m.net > 0.01
                      ? `${fmt(m.net)} à reverser`
                      : m.net < -0.01
                        ? `${fmt(-m.net)} crédit`
                        : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-100 font-semibold">
              <td className="px-3 py-2">Total {exercice}</td>
              {rates.map((r, i) => (
                <td
                  key={"yc-" + r}
                  className={`px-3 py-2 text-right tabular-nums ${i === 0 ? "border-l" : ""}`}
                >
                  {fmt(yearly.collected[r] ?? 0)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">
                {fmt(yearly.collectedTotal)}
              </td>
              {rates.map((r, i) => (
                <td
                  key={"yd-" + r}
                  className={`px-3 py-2 text-right tabular-nums ${i === 0 ? "border-l" : ""}`}
                >
                  {fmt(yearly.deductible[r] ?? 0)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">
                {fmt(yearly.deductibleTotal)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums border-l ${
                  yearly.net > 0.01
                    ? "text-red-700"
                    : yearly.net < -0.01
                      ? "text-emerald-700"
                      : "text-neutral-400"
                }`}
              >
                {yearly.net > 0.01
                  ? `${fmt(yearly.net)} à reverser`
                  : yearly.net < -0.01
                    ? `${fmt(-yearly.net)} crédit`
                    : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
