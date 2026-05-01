import { ComingSoon } from "@/components/coming-soon";

export default function InvoicesPage() {
  return (
    <ComingSoon
      title="Factures"
      todos={[
        "Liste des factures émises (séquentielle ininterrompue)",
        "Émission depuis une commande validée",
        "Génération PDF conforme + archive Vercel Blob",
        "Facturation proforma & avoirs",
        "Suivi paiement (rapprochement Qonto)",
        "À prévoir 09/2027 : export Factur-X via PDP agréée",
      ]}
    />
  );
}
