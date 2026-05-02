import Image from "next/image";
import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";

const NAV_GROUPS: Array<{
  label: string;
  items: { href: string; label: string }[];
}> = [
  {
    label: "Pilotage",
    items: [{ href: "/dashboard", label: "Tableau de bord" }],
  },
  {
    label: "Référentiel",
    items: [
      { href: "/clients", label: "Clients" },
      { href: "/suppliers", label: "Fournisseurs" },
      { href: "/products", label: "Catalogue" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/orders", label: "Commandes" },
      { href: "/invoices", label: "Factures clients" },
      { href: "/supplier-invoices", label: "Factures fournisseurs" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/banque", label: "Banque (Qonto)" },
      { href: "/accounting", label: "Comptabilité" },
    ],
  },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <div className="grid min-h-dvh grid-cols-[220px_1fr]">
      <aside className="flex flex-col bg-blue-600 text-white/70">
        <div className="border-b border-white/10 px-4 py-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Image
              src="/logo.jpg"
              alt="LCD"
              width={42}
              height={42}
              className="rounded bg-white object-contain p-1"
            />
            <div>
              <div className="text-[15px] font-bold tracking-tight text-white">
                LCD ModComm
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/40">
                Lascia Corre Distribution
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 text-[13px]">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white/45">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block rounded px-3 py-1.5 font-bold transition hover:bg-white/10 hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-[12px] font-semibold text-white/60 transition hover:text-white"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      <main className="overflow-y-auto bg-slate-50 px-8 py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
