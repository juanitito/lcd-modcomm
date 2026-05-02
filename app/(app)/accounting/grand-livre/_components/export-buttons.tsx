"use client";

type Params = {
  account: string;
  from: string;
  to: string;
  q: string;
};

function buildUrl(format: "csv" | "xlsx" | "fec", p: Params): string {
  const qs = new URLSearchParams();
  if (p.account) qs.set("account", p.account);
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  if (p.q) qs.set("q", p.q);
  qs.set("format", format);
  return `/api/accounting/grand-livre/export?${qs.toString()}`;
}

export function ExportButtons({ params }: { params: Params }) {
  return (
    <div className="flex gap-2">
      <a
        href={buildUrl("csv", params)}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:border-neutral-500"
      >
        Export CSV
      </a>
      <a
        href={buildUrl("xlsx", params)}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:border-neutral-500"
      >
        Export XLSX
      </a>
      <a
        href={buildUrl("fec", params)}
        className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700 hover:border-indigo-500"
        title="Fichier des Écritures Comptables — format légal pour l'expert-comptable"
      >
        Export FEC
      </a>
    </div>
  );
}
