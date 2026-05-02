import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

function formatPeriod(p: string): string {
  // "MM-YYYY" → "Mois YYYY" en français
  const [m, y] = p.split("-");
  const months = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx] ?? m} ${y}`;
}

export default async function StatementsPage() {
  const stmts = await db
    .select()
    .from(schema.bankStatements)
    .orderBy(desc(schema.bankStatements.period));

  return (
    <div className="max-w-4xl">
      <div>
        <Link
          href="/banque"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ‹ Banque
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          Relevés bancaires Qonto
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          {stmts.length} relevé{stmts.length > 1 ? "s" : ""} mensuels archivés
          sur Vercel Blob (10 ans). Les PDFs sont récupérés via l&apos;API
          Qonto et conservés pour la compta.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Période</th>
              <th className="px-3 py-2 font-medium">Fichier</th>
              <th className="px-3 py-2 font-medium text-right">Taille</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {stmts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-neutral-500">
                  Aucun relevé. Lance{" "}
                  <code className="rounded bg-neutral-100 px-1">
                    npm run qonto:statements
                  </code>{" "}
                  pour importer.
                </td>
              </tr>
            ) : (
              stmts.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium">
                    {formatPeriod(s.period)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                    {s.fileName}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                    {(s.fileSize / 1024).toFixed(0)} ko
                  </td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={s.pdfBlobUrl}
                      target="_blank"
                      rel="noopener"
                      className="text-xs text-neutral-700 underline hover:text-neutral-900"
                    >
                      Ouvrir le PDF
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
