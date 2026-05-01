import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold">LCD ModComm</Link>
            <nav className="flex items-center gap-4 text-sm text-neutral-600">
              <Link href="/clients" className="hover:text-neutral-900">Clients</Link>
              <Link href="/products" className="hover:text-neutral-900">Catalogue</Link>
              <Link href="/orders" className="hover:text-neutral-900">Commandes</Link>
              <Link href="/invoices" className="hover:text-neutral-900">Factures</Link>
              <Link href="/suppliers" className="hover:text-neutral-900">Fournisseurs</Link>
              <Link href="/accounting" className="hover:text-neutral-900">Compta</Link>
            </nav>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
