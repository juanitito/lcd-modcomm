import { ComingSoon } from "@/components/coming-soon";

export default function SuppliersPage() {
  return (
    <ComingSoon
      title="Fournisseurs"
      todos={[
        "Fiches fournisseurs (MR Net en premier)",
        "Bons de commande fournisseurs",
        "Saisie factures fournisseurs (PDF + extraction LLM)",
        "Rapprochement avec opérations Qonto sortantes",
      ]}
    />
  );
}
