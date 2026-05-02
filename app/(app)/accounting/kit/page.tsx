import Link from "next/link";

const YEARS = ["2024", "2025", "2026"];

export default function KitPage() {
  return (
    <div>
      <p className="text-xs text-neutral-500">
        <Link href="/accounting" className="hover:underline">
          Comptabilité
        </Link>{" "}
        / Kit expert-comptable
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Kit expert-comptable</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        Génération d'un dossier ZIP complet pour l'expert-comptable contenant
        toutes les pièces de l'exercice : grand livre, factures vente, factures
        achat, relevés bancaires, états créances/dettes, pré-bilan, compte de
        résultat et déclaration TVA. Un README généré automatiquement résume
        les chiffres-clés.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3 max-w-2xl">
        {YEARS.map((y) => (
          <a
            key={y}
            href={`/api/accounting/kit?exercice=${y}`}
            className="flex flex-col rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-400"
          >
            <span className="text-xs uppercase text-neutral-500">Exercice</span>
            <span className="mt-1 text-2xl font-semibold">{y}</span>
            <span className="mt-3 text-xs text-neutral-600">
              ↓ Télécharger LCD-Comptabilite-{y}.zip
            </span>
          </a>
        ))}
      </div>

      <div className="mt-8 max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        ⚠ La génération peut prendre 30-60 secondes selon le nombre de
        factures (téléchargement des PDFs depuis Vercel Blob). Patience.
      </div>

      <div className="mt-6 max-w-2xl text-xs text-neutral-600">
        <h3 className="font-semibold">Contenu du ZIP</h3>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          <li><code>1-Grand-Livre/</code> — CSV + XLSX (avec une feuille par compte)</li>
          <li><code>2-Factures-Vente/</code> — PDFs renumérotés (YYMMDD-LCD-Facture-X)</li>
          <li><code>3-Factures-Achat/</code> — PDFs renommés (YYMMDD-LCD-FacFour-X)</li>
          <li><code>4-Releves-Bancaires/</code> — relevés Qonto mensuels</li>
          <li><code>5-Creances-Dettes/</code> — état au 31/12</li>
          <li><code>6-Pre-Bilan/</code> — actif/passif (non certifié)</li>
          <li><code>7-Compte-Resultat/</code> — charges/produits</li>
          <li><code>8-TVA/</code> — ventilation par mois × taux</li>
          <li><code>README.txt</code> — chiffres-clés générés automatiquement</li>
        </ul>
      </div>
    </div>
  );
}
