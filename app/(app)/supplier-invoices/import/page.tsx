import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { UploadForm } from "@/components/invoice-import/upload-form";
import { ImportRow } from "@/components/invoice-import/import-row";

export default async function SupplierInvoiceImportPage() {
  const imports = await db.query.invoiceImports.findMany({
    where: eq(schema.invoiceImports.direction, "supplier"),
    orderBy: [desc(schema.invoiceImports.createdAt)],
  });

  const suppliers = await db
    .select({
      id: schema.suppliers.id,
      code: schema.suppliers.code,
      name: schema.suppliers.name,
    })
    .from(schema.suppliers)
    .orderBy(asc(schema.suppliers.code));

  const counts = imports.reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link
            href="/supplier-invoices"
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            ‹ Factures fournisseurs
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            Import historique factures fournisseurs
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Dépose des PDFs de factures que tu as REÇUES : archivage sur
            Vercel Blob, extraction LLM, matching fournisseur par SIRET/nom.
            ⚠️ Le fournisseur doit exister dans{" "}
            <Link href="/suppliers" className="underline">
              ta base
            </Link>{" "}
            pour pouvoir matérialiser la facture.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <UploadForm direction="supplier" />
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700">
            Imports fournisseurs ({imports.length})
          </h2>
          <div className="flex gap-3 text-xs text-neutral-500">
            {Object.entries(counts).map(([k, v]) => (
              <span key={k}>
                {k} : <strong className="text-neutral-700">{v}</strong>
              </span>
            ))}
          </div>
        </div>

        {imports.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            Aucun import fournisseur pour l&apos;instant.
          </p>
        ) : (
          <div className="grid gap-3">
            {imports.map((i) => (
              <ImportRow key={i.id} imp={i} clients={[]} suppliers={suppliers} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
