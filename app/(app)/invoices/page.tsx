import Link from "next/link";
import { ComingSoon } from "@/components/coming-soon";

export default function InvoicesPage() {
  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Factures</h1>
        <Link
          href="/invoices/import"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-500"
        >
          Importer un PDF historique
        </Link>
      </div>

      <ComingSoon
        title="Émission de factures"
        todos={[
          "Liste des factures émises (séquentielle ininterrompue F-YYYY-NNNN)",
          "Émission depuis une commande validée",
          "Génération PDF conforme + archive Vercel Blob",
          "Facturation proforma & avoirs",
          "Suivi paiement (rapprochement Qonto)",
          "À prévoir 09/2027 : export Factur-X via PDP agréée",
        ]}
      />
    </div>
  );
}
