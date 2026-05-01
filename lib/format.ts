// Affichage cohérent des montants HT/TTC/TVA et autres helpers UI.

const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eur4 = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const num3 = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export function formatEur(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return eur.format(n);
}

// Pour des prix unitaires (PA, PDV) qui ont 4 décimales en stock.
export function formatEurUnit(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return eur4.format(n);
}

export function formatNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return num3.format(n);
}

export function formatPct(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

// Marge en % calculée à partir de PA et PDV HT.
export function marginPct(
  purchase: string | number | null | undefined,
  sale: string | number | null | undefined,
): number | null {
  const pa = typeof purchase === "string" ? Number(purchase) : purchase;
  const pdv = typeof sale === "string" ? Number(sale) : sale;
  if (!Number.isFinite(pa as number) || !Number.isFinite(pdv as number) || !pa) return null;
  return ((pdv as number) - (pa as number)) / (pa as number) * 100;
}
