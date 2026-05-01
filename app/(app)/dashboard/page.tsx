export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Tableau de bord</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Bienvenue. Le tableau de bord viendra ici une fois les premières données saisies.
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card title="Clients" desc="Gérer les restaurateurs et leurs tarifs négociés." href="/clients" />
        <Card title="Catalogue" desc="Produits, prix d'achat, prix de vente, fournisseurs." href="/products" />
        <Card title="Commandes" desc="Devis, prises de commande, bons de livraison." href="/orders" />
        <Card title="Factures" desc="Émission et historique. Numérotation séquentielle." href="/invoices" />
        <Card title="Fournisseurs" desc="Bons de commande fournisseurs (MR Net, autres)." href="/suppliers" />
        <Card title="Compta" desc="Plan comptable, journaux, balance, FEC." href="/accounting" />
      </div>
    </div>
  );
}

function Card({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a
      href={href}
      className="block rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-400 hover:shadow-sm transition"
    >
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-neutral-600">{desc}</p>
    </a>
  );
}
