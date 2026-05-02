import Link from "next/link";

const SECTIONS = [
  {
    href: "/accounting/grand-livre",
    title: "Grand livre",
    desc: "Toutes les écritures de l'exercice, filtrables par compte et période. Exports CSV/XLSX.",
    ready: true,
  },
  {
    href: "/accounting/tva",
    title: "TVA",
    desc: "Déclarations mensuelles, ventilation par taux (Corse 2,1% / 20%). Export XLSX format CA3.",
    ready: true,
  },
  {
    href: "/accounting/creances-dettes",
    title: "Créances & dettes",
    desc: "Factures non lettrées au 31/12 — créances clients et dettes fournisseurs.",
    ready: true,
  },
  {
    href: "/accounting/pre-bilan",
    title: "Pré-bilan",
    desc: "Actif / passif au 31/12. Document non certifié, à valider avec le comptable.",
    ready: false,
  },
  {
    href: "/accounting/compte-resultat",
    title: "Compte de résultat",
    desc: "Produits / charges / résultat net sur la période.",
    ready: false,
  },
  {
    href: "/accounting/kit",
    title: "Kit expert-comptable",
    desc: "Génération d'un ZIP complet (grand livre + factures + relevés + états) par exercice.",
    ready: false,
  },
];

export default function AccountingPage() {
  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold">Comptabilité</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Module conçu pour produire le dossier annuel destiné à l'expert-comptable.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.ready ? s.href : "#"}
            className={`rounded-lg border p-4 transition ${
              s.ready
                ? "border-neutral-200 bg-white hover:border-neutral-400"
                : "border-neutral-200 bg-neutral-50 opacity-60"
            }`}
            aria-disabled={!s.ready}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{s.title}</h2>
              {!s.ready ? (
                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                  bientôt
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-neutral-600">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
