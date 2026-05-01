import Link from "next/link";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatEurUnit, formatPct, marginPct } from "@/lib/format";
import { SearchInput } from "@/components/search-input";
import { FilterSelect } from "@/components/filter-select";

const PAGE_SIZE = 50;

type SP = Promise<{
  q?: string;
  supplier?: string;
  family?: string;
  page?: string;
}>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const supplierCode = sp.supplier ?? "";
  const familyCode = sp.family ?? "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const [suppliers, families] = await Promise.all([
    db.select().from(schema.suppliers).orderBy(asc(schema.suppliers.code)),
    db.select().from(schema.productFamilies).orderBy(asc(schema.productFamilies.code)),
  ]);

  const supplierId = supplierCode ? suppliers.find((s) => s.code === supplierCode)?.id : undefined;
  const familyId = familyCode ? families.find((f) => f.code === familyCode)?.id : undefined;

  const where = and(
    q
      ? or(
          ilike(schema.products.code, `%${q}%`),
          ilike(schema.products.designation, `%${q}%`),
        )
      : undefined,
    supplierId ? eq(schema.products.supplierId, supplierId) : undefined,
    familyId ? eq(schema.products.familyId, familyId) : undefined,
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.products)
    .where(where);

  const products = await db
    .select({
      id: schema.products.id,
      code: schema.products.code,
      designation: schema.products.designation,
      conditionnement: schema.products.conditionnement,
      purchasePriceHt: schema.products.purchasePriceHt,
      defaultSalePriceHt: schema.products.defaultSalePriceHt,
      vatRate: schema.products.vatRate,
      active: schema.products.active,
      supplierCode: schema.suppliers.code,
      familyCode: schema.productFamilies.code,
    })
    .from(schema.products)
    .leftJoin(schema.suppliers, eq(schema.products.supplierId, schema.suppliers.id))
    .leftJoin(
      schema.productFamilies,
      eq(schema.products.familyId, schema.productFamilies.id),
    )
    .where(where)
    .orderBy(asc(schema.products.code))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const supplierOptions = suppliers.map((s) => ({ value: s.code, label: s.name || s.code }));
  const familyOptions = families.map((f) => ({ value: f.code, label: f.label || f.code }));

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Catalogue produits</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {total} produit{total > 1 ? "s" : ""} {q || supplierCode || familyCode ? "filtrés" : "au catalogue"}.
          </p>
        </div>
        <Link
          href="/products/new"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-500"
        >
          Nouveau produit
        </Link>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <SearchInput
          initial={q}
          basePath="/products"
          placeholder="Rechercher (code, désignation)…"
        />
        <FilterSelect
          name="supplier"
          value={supplierCode}
          options={supplierOptions}
          placeholder="Tous fournisseurs"
          basePath="/products"
        />
        <FilterSelect
          name="family"
          value={familyCode}
          options={familyOptions}
          placeholder="Toutes familles"
          basePath="/products"
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Désignation</th>
              <th className="px-3 py-2 font-medium">Cond.</th>
              <th className="px-3 py-2 font-medium">Frn</th>
              <th className="px-3 py-2 font-medium text-right">PA HT</th>
              <th className="px-3 py-2 font-medium text-right">PDV HT</th>
              <th className="px-3 py-2 font-medium text-right">Marge</th>
              <th className="px-3 py-2 font-medium text-right">TVA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {products.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-neutral-500">
                  Aucun produit ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const m = marginPct(p.purchasePriceHt, p.defaultSalePriceHt);
                return (
                  <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/products/${p.id}`} className="hover:underline">
                        {p.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{p.designation}</td>
                    <td className="px-3 py-2 text-neutral-600">{p.conditionnement ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{p.supplierCode ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatEurUnit(p.purchasePriceHt)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatEurUnit(p.defaultSalePriceHt)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {m === null ? "—" : formatPct(m)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">
                      {formatPct(p.vatRate)}
                    </td>
                  </tr>
                );
              })
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
            {page < pageCount ? <PageLink sp={sp} page={page + 1} label="Suivant ›" /> : null}
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
  sp: { q?: string; supplier?: string; family?: string };
  page: number;
  label: string;
}) {
  const u = new URLSearchParams();
  if (sp.q) u.set("q", sp.q);
  if (sp.supplier) u.set("supplier", sp.supplier);
  if (sp.family) u.set("family", sp.family);
  u.set("page", String(page));
  return (
    <Link
      href={`/products?${u.toString()}`}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1 hover:border-neutral-500"
    >
      {label}
    </Link>
  );
}
