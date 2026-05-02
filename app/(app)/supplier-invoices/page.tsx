import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatEur } from "@/lib/format";

export default async function SupplierInvoicesPage() {
  const invoices = await db
    .select({
      id: schema.supplierInvoices.id,
      number: schema.supplierInvoices.supplierInvoiceNumber,
      issueDate: schema.supplierInvoices.issueDate,
      totalTtc: schema.supplierInvoices.totalTtc,
      status: schema.supplierInvoices.status,
      supplierId: schema.supplierInvoices.supplierId,
      supplierCode: schema.suppliers.code,
      supplierName: schema.suppliers.name,
    })
    .from(schema.supplierInvoices)
    .leftJoin(
      schema.suppliers,
      eq(schema.supplierInvoices.supplierId, schema.suppliers.id),
    )
    .orderBy(desc(schema.supplierInvoices.issueDate));

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Factures fournisseurs</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {invoices.length} facture{invoices.length > 1 ? "s" : ""} reçue
            {invoices.length > 1 ? "s" : ""}.
          </p>
        </div>
        <Link
          href="/supplier-invoices/import"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-500"
        >
          Importer un PDF historique
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">N°</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Fournisseur</th>
              <th className="px-3 py-2 font-medium text-right">Total TTC</th>
              <th className="px-3 py-2 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-neutral-500">
                  Aucune facture fournisseur.{" "}
                  <Link
                    href="/supplier-invoices/import"
                    className="underline hover:text-neutral-700"
                  >
                    Importer le premier PDF
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              invoices.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2 font-mono text-xs">{i.number}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600 tabular-nums">
                    {i.issueDate}
                  </td>
                  <td className="px-3 py-2">
                    {i.supplierId ? (
                      <Link
                        href={`/suppliers/${i.supplierId}`}
                        className="hover:underline"
                      >
                        <span className="font-mono text-xs text-neutral-500">
                          {i.supplierCode}
                        </span>{" "}
                        {i.supplierName ?? "?"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(i.totalTtc)}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{i.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
