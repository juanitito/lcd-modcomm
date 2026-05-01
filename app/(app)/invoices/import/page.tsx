import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { UploadForm } from "./_components/upload-form";
import { ImportRow } from "./_components/import-row";

export default async function InvoiceImportPage() {
  const imports = await db.query.invoiceImports.findMany({
    orderBy: [desc(schema.invoiceImports.createdAt)],
  });

  const clients = await db
    .select({
      id: schema.clients.id,
      code: schema.clients.code,
      name: schema.clients.name,
    })
    .from(schema.clients)
    .orderBy(asc(schema.clients.code));

  const counts = imports.reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link
            href="/invoices"
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            ‹ Factures
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            Import historique factures
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Dépose des PDFs : ils sont archivés sur Vercel Blob, puis extraits
            via LLM (numéro héritage, dates, lignes, totaux). Les factures
            importées sont préfixées <code>LEGACY-</code> et n&apos;entrent
            pas dans la séquence officielle.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <UploadForm />
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700">
            Imports ({imports.length})
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
            Aucun import pour l&apos;instant.
          </p>
        ) : (
          <div className="grid gap-3">
            {imports.map((i) => (
              <ImportRow key={i.id} imp={i} clients={clients} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
