import Link from "next/link";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SearchInput } from "@/components/search-input";
import { FilterSelect } from "@/components/filter-select";

const PAGE_SIZE = 50;

type SP = Promise<{
  q?: string;
  category?: string;
  zone?: string;
  page?: string;
}>;

export default async function ClientsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const categoryCode = sp.category ?? "";
  const zone = sp.zone ?? "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const categories = await db
    .select()
    .from(schema.clientCategories)
    .orderBy(asc(schema.clientCategories.label));

  const zones = await db
    .selectDistinctOn([schema.clients.geoZone], { zone: schema.clients.geoZone })
    .from(schema.clients)
    .orderBy(asc(schema.clients.geoZone));
  const zoneOptions = zones
    .map((z) => z.zone)
    .filter((z): z is string => !!z)
    .map((z) => ({ value: z, label: z }));

  const categoryId = categoryCode
    ? categories.find((c) => c.code === categoryCode)?.id
    : undefined;

  const where = and(
    q
      ? or(
          ilike(schema.clients.code, `%${q}%`),
          ilike(schema.clients.name, `%${q}%`),
          ilike(schema.clients.legalName, `%${q}%`),
          ilike(schema.clients.siret, `%${q}%`),
          ilike(schema.clients.billingCity, `%${q}%`),
        )
      : undefined,
    categoryId ? eq(schema.clients.categoryId, categoryId) : undefined,
    zone ? eq(schema.clients.geoZone, zone) : undefined,
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.clients)
    .where(where);

  const clients = await db
    .select({
      id: schema.clients.id,
      code: schema.clients.code,
      name: schema.clients.name,
      legalName: schema.clients.legalName,
      billingCity: schema.clients.billingCity,
      geoZone: schema.clients.geoZone,
      active: schema.clients.active,
      categoryLabel: schema.clientCategories.label,
    })
    .from(schema.clients)
    .leftJoin(
      schema.clientCategories,
      eq(schema.clients.categoryId, schema.clientCategories.id),
    )
    .where(where)
    .orderBy(asc(schema.clients.code))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const categoryOptions = categories.map((c) => ({
    value: c.code,
    label: c.label,
  }));

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {total} client{total > 1 ? "s" : ""}{" "}
            {q || categoryCode || zone ? "filtrés" : "au fichier"}.
          </p>
        </div>
        <Link
          href="/clients/new"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-500"
        >
          Nouveau client
        </Link>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <SearchInput
          initial={q}
          basePath="/clients"
          placeholder="Rechercher (code, nom, SIRET, ville)…"
        />
        <FilterSelect
          name="category"
          value={categoryCode}
          options={categoryOptions}
          placeholder="Toutes catégories"
          basePath="/clients"
        />
        <FilterSelect
          name="zone"
          value={zone}
          options={zoneOptions}
          placeholder="Toutes zones"
          basePath="/clients"
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Nom</th>
              <th className="px-3 py-2 font-medium">Raison sociale</th>
              <th className="px-3 py-2 font-medium">Ville</th>
              <th className="px-3 py-2 font-medium">ZG</th>
              <th className="px-3 py-2 font-medium">Catégorie</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {clients.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-neutral-500">
                  Aucun client ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              clients.map((c) => (
                <tr key={c.id} className={c.active ? "" : "opacity-50"}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/clients/${c.id}`} className="hover:underline">
                      {c.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 text-neutral-600">
                    {c.legalName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {c.billingCity ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {c.geoZone ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {c.categoryLabel ?? "—"}
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
  sp: { q?: string; category?: string; zone?: string };
  page: number;
  label: string;
}) {
  const u = new URLSearchParams();
  if (sp.q) u.set("q", sp.q);
  if (sp.category) u.set("category", sp.category);
  if (sp.zone) u.set("zone", sp.zone);
  u.set("page", String(page));
  return (
    <Link
      href={`/clients?${u.toString()}`}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1 hover:border-neutral-500"
    >
      {label}
    </Link>
  );
}
