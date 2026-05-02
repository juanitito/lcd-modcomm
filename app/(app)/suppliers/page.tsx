import Link from "next/link";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SearchInput } from "@/components/search-input";
import { FilterSelect } from "@/components/filter-select";

const PAGE_SIZE = 50;

type SP = Promise<{
  q?: string;
  active?: "active" | "inactive";
  page?: string;
}>;

export default async function SuppliersPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const activeFilter = sp.active ?? "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const where = and(
    q
      ? or(
          ilike(schema.suppliers.code, `%${q}%`),
          ilike(schema.suppliers.name, `%${q}%`),
          ilike(schema.suppliers.legalName, `%${q}%`),
          ilike(schema.suppliers.siret, `%${q}%`),
        )
      : undefined,
    activeFilter === "active"
      ? eq(schema.suppliers.active, true)
      : activeFilter === "inactive"
        ? eq(schema.suppliers.active, false)
        : undefined,
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.suppliers)
    .where(where);

  const suppliers = await db
    .select({
      id: schema.suppliers.id,
      code: schema.suppliers.code,
      name: schema.suppliers.name,
      legalName: schema.suppliers.legalName,
      siret: schema.suppliers.siret,
      contactEmail: schema.suppliers.contactEmail,
      contactPhone: schema.suppliers.contactPhone,
      active: schema.suppliers.active,
    })
    .from(schema.suppliers)
    .where(where)
    .orderBy(asc(schema.suppliers.code))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Fournisseurs</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {total} fournisseur{total > 1 ? "s" : ""}{" "}
            {q || activeFilter ? "filtrés" : "au fichier"}.
          </p>
        </div>
        <Link
          href="/suppliers/new"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-500"
        >
          Nouveau fournisseur
        </Link>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <SearchInput
          initial={q}
          basePath="/suppliers"
          placeholder="Rechercher (code, nom, raison sociale, SIRET)…"
        />
        <FilterSelect
          name="active"
          value={activeFilter}
          options={[
            { value: "active", label: "Actifs" },
            { value: "inactive", label: "Inactifs" },
          ]}
          placeholder="Tous (actif)"
          basePath="/suppliers"
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Nom commercial</th>
              <th className="px-3 py-2 font-medium">Raison sociale</th>
              <th className="px-3 py-2 font-medium">SIRET</th>
              <th className="px-3 py-2 font-medium">Contact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-neutral-500">
                  Aucun fournisseur ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              suppliers.map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/suppliers/${s.id}`} className="hover:underline">
                      {s.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{s.legalName ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                    {s.siret ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {s.contactEmail ?? s.contactPhone ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-neutral-600">
          <span>
            Page {page} / {pageCount}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <PageLink sp={sp} page={page - 1} label="‹ Précédent" />
            ) : null}
            {page < pageCount ? (
              <PageLink sp={sp} page={page + 1} label="Suivant ›" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PageLink({
  sp,
  page,
  label,
}: {
  sp: { q?: string; active?: string };
  page: number;
  label: string;
}) {
  const u = new URLSearchParams();
  if (sp.q) u.set("q", sp.q);
  if (sp.active) u.set("active", sp.active);
  u.set("page", String(page));
  return (
    <Link
      href={`/suppliers?${u.toString()}`}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1 hover:border-neutral-500"
    >
      {label}
    </Link>
  );
}
