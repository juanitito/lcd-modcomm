import { ComingSoon } from "@/components/coming-soon";

export default function ClientsPage() {
  return (
    <ComingSoon
      title="Clients"
      todos={[
        "Liste des restaurateurs (import depuis BDDC)",
        "Fiche client : adresses fact/liv, SIRET, IBAN, contacts, zone géo",
        "Catégorie client (grossiste / restaurateur / …) avec marge par défaut",
        "Onglet 'tarifs négociés' (table client_product_prices)",
        "Onglet 'historique commandes & factures'",
      ]}
    />
  );
}
