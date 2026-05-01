// Données de référence à charger lors du premier démarrage.
// Catégories de clients (purement descriptives — la marge reste libre).

export const CLIENT_CATEGORIES = [
  { code: "restaurant", label: "Restaurant" },
  { code: "snack", label: "Snack" },
  { code: "boulangerie", label: "Boulangerie" },
  { code: "grossiste", label: "Grossiste" },
  { code: "hotel", label: "Hôtel" },
  { code: "foodtruck", label: "Foodtruck" },
  { code: "hopital", label: "Hôpital" },
  { code: "autre", label: "Autre" },
] as const;

// Taux de TVA possibles : métropole + Corse (CGI art. 297).
export const VAT_RATES = [
  { rate: "20.00", label: "20 % — taux normal" },
  { rate: "13.00", label: "13 % — Corse, produits pétroliers" },
  { rate: "10.00", label: "10 % — taux intermédiaire / Corse certains" },
  { rate: "5.50", label: "5,5 % — taux réduit" },
  { rate: "2.10", label: "2,1 % — taux super-réduit / Corse" },
  { rate: "0.90", label: "0,9 % — Corse certaines opérations" },
  { rate: "0.00", label: "0 % — exonéré" },
] as const;
