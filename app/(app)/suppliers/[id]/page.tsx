import { notFound } from "next/navigation";
import Link from "next/link";
import { count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SupplierForm } from "./_components/supplier-form";
import { createSupplier, updateSupplier } from "./_actions";
import { formatEur } from "@/lib/format";

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id === "new") {
    return (
      <div className="max-w-4xl">
        <Header backLabel="‹ Fournisseurs" backHref="/suppliers" title="Nouveau fournisseur" />
        <div className="mt-6">
          <SupplierForm
            mode="create"
            initial={{ active: true }}
            action={createSupplier}
          />
        </div>
      </div>
    );
  }

  const s = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.id, id),
  });
  if (!s) notFound();

  const [productCountRow, supplierInvoiceStats, recentInvoices] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.products)
      .where(eq(schema.products.supplierId, s.id)),
    db
      .select({
        n: count(),
        totalTtc: sql<string>`coalesce(sum(${schema.supplierInvoices.totalTtc}), 0)`,
      })
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.supplierId, s.id)),
    db
      .select({
        id: schema.supplierInvoices.id,
        supplierInvoiceNumber: schema.supplierInvoices.supplierInvoiceNumber,
        issueDate: schema.supplierInvoices.issueDate,
        totalTtc: schema.supplierInvoices.totalTtc,
        status: schema.supplierInvoices.status,
      })
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.supplierId, s.id))
      .orderBy(desc(schema.supplierInvoices.issueDate))
      .limit(10),
  ]);

  const productCount = productCountRow[0]?.n ?? 0;
  const invCount = supplierInvoiceStats[0]?.n ?? 0;
  const invTotal = Number(supplierInvoiceStats[0]?.totalTtc ?? 0);

  return (
    <div className="max-w-4xl">
      <Header
        backLabel="‹ Fournisseurs"
        backHref="/suppliers"
        title={s.name}
        subtitle={
          <span className="font-mono text-xs text-neutral-500">{s.code}</span>
        }
      />

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Stat label="Produits référencés" value={String(productCount)} />
        <Stat label="Factures importées" value={String(invCount)} />
        <Stat label="Total TTC reçu" value={formatEur(invTotal)} />
      </div>

      <div className="mt-6">
        <SupplierForm
          mode="edit"
          initial={{
            code: s.code,
            name: s.name,
            legalName: s.legalName,
            siret: s.siret,
            vatNumber: s.vatNumber,
            contactEmail: s.contactEmail,
            contactPhone: s.contactPhone,
            customerAccountNumber: s.customerAccountNumber,
            active: s.active,
          }}
          action={updateSupplier.bind(null, s.id)}
        />
      </div>

      {recentInvoices.length > 0 ? (
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">
            Dernières factures fournisseur
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1 font-medium">N°</th>
                <th className="px-2 py-1 font-medium">Date</th>
                <th className="px-2 py-1 font-medium text-right">Total TTC</th>
                <th className="px-2 py-1 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {recentInvoices.map((i) => (
                <tr key={i.id}>
                  <td className="px-2 py-1 font-mono text-xs">
                    {i.supplierInvoiceNumber}
                  </td>
                  <td className="px-2 py-1 text-xs text-neutral-600">
                    {i.issueDate}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {formatEur(i.totalTtc)}
                  </td>
                  <td className="px-2 py-1 text-xs text-neutral-500">{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Header({
  backLabel,
  backHref,
  title,
  subtitle,
}: {
  backLabel: string;
  backHref: string;
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div>
      <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-900">
        {backLabel}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      {subtitle ? <div className="mt-1">{subtitle}</div> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="text-xs uppercase text-neutral-500">{label}</div>
      <div className="mt-1 tabular-nums">{value}</div>
    </div>
  );
}
