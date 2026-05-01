import { ComingSoon } from "@/components/coming-soon";

export default function OrdersPage() {
  return (
    <ComingSoon
      title="Commandes"
      todos={[
        "Saisie d'une commande client (sélection produits, qté, prix appliqué)",
        "Application auto des prix négociés / marge catégorie",
        "Génération devis PDF",
        "Confirmation → bon de livraison",
        "Bascule vers facturation",
      ]}
    />
  );
}
