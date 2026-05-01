import { ComingSoon } from "@/components/coming-soon";

export default function ProductsPage() {
  return (
    <ComingSoon
      title="Catalogue produits"
      todos={[
        "Liste des produits (import depuis BDDP)",
        "Fiche produit : conditionnement, MOQ, fournisseur, PA, PDV, TVA",
        "Liens FT / FDS / photo (Google Drive ou Vercel Blob)",
        "Famille produit & flag contact alimentaire (FAL)",
        "Édition en masse (copier-coller depuis Excel)",
      ]}
    />
  );
}
