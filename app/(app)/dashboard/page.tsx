import Link from "next/link";
import { and, count, desc, eq, gte, isNull, max, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatEur } from "@/lib/format";

const startOfYear = () => {
  const y = new Date().getUTCFullYear();
  return `${y}-01-01`;
};

export default async function DashboardPage() {
  const yearStart = startOfYear();
  const currentYear = new Date().getUTCFullYear();

  const [
    [{ qontoTotal, lastSync, lastBalance, unmatchedCount }],
    [{ caYearTtc, caYearCount }],
    [{ achatYearTtc, achatYearCount }],
    topClientsRaw,
    topSuppliersRaw,
    [{ stmtsCount }],
  ] = await Promise.all([
    db
      .select({
        qontoTotal: count(),
        lastSync: max(schema.qontoTransactions.settledAt),
        lastBalance: sql<string | null>`(
          SELECT ((raw_json->>'settled_balance')::numeric)::text
          FROM qonto_transactions
          WHERE settled_at = (SELECT max(settled_at) FROM qonto_transactions)
          LIMIT 1
        )`,
        unmatchedCount: sql<number>`(
          SELECT count(*)::int FROM qonto_transactions
          WHERE matched_invoice_id IS NULL AND matched_supplier_invoice_id IS NULL
        )`,
      })
      .from(schema.qontoTransactions),
    db
      .select({
        caYearTtc: sql<string>`coalesce(sum(${schema.invoices.totalTtc}), 0)`,
        caYearCount: count(),
      })
      .from(schema.invoices)
      .where(gte(schema.invoices.issueDate, yearStart)),
    db
      .select({
        achatYearTtc: sql<string>`coalesce(sum(${schema.supplierInvoices.totalTtc}), 0)`,
        achatYearCount: count(),
      })
      .from(schema.supplierInvoices)
      .where(gte(schema.supplierInvoices.issueDate, yearStart)),
    db
      .select({
        clientName: sql<string>`${schema.invoices.clientSnapshot}->>'name'`,
        total: sql<string>`sum(${schema.invoices.totalTtc})`,
        n: count(),
      })
      .from(schema.invoices)
      .where(gte(schema.invoices.issueDate, yearStart))
      .groupBy(sql`${schema.invoices.clientSnapshot}->>'name'`)
      .orderBy(sql`sum(${schema.invoices.totalTtc}) desc`)
      .limit(3),
    db
      .select({
        supplierName: schema.suppliers.name,
        total: sql<string>`sum(${schema.supplierInvoices.totalTtc})`,
        n: count(),
      })
      .from(schema.supplierInvoices)
      .leftJoin(
        schema.suppliers,
        eq(schema.supplierInvoices.supplierId, schema.suppliers.id),
      )
      .where(gte(schema.supplierInvoices.issueDate, yearStart))
      .groupBy(schema.suppliers.name)
      .orderBy(sql`sum(${schema.supplierInvoices.totalTtc}) desc`)
      .limit(3),
    db.select({ stmtsCount: count() }).from(schema.bankStatements),
  ]);

  const balance = lastBalance ? Number(lastBalance) : null;
  const ca = Number(caYearTtc);
  const achat = Number(achatYearTtc);
  const marge = ca - achat;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tableau de bord</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Lascia Corre Distribution · exercice {currentYear}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Solde Qonto"
          value={balance != null ? formatEur(balance) : "—"}
          sub={
            lastSync
              ? `dernière op. ${new Date(lastSync).toLocaleDateString("fr-FR")}`
              : "pas de sync"
          }
        />
        <Stat
          label={`CA ${currentYear} (TTC)`}
          value={formatEur(ca)}
          sub={`${caYearCount} facture${caYearCount > 1 ? "s" : ""} client`}
        />
        <Stat
          label={`Achats ${currentYear} (TTC)`}
          value={formatEur(achat)}
          sub={`${achatYearCount} facture${achatYearCount > 1 ? "s" : ""} fournisseur`}
        />
        <Stat
          label={`Solde net ${currentYear}`}
          value={formatEur(marge)}
          sub={marge >= 0 ? "≈ marge brute TTC" : "déficit"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`Top clients ${currentYear}`}>
          {topClientsRaw.length === 0 ? (
            <Empty>Aucune facture client cette année.</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-neutral-100">
                {topClientsRaw.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">{r.clientName ?? "?"}</td>
                    <td className="px-2 py-1.5 text-right text-xs text-neutral-500">
                      {r.n} fact.
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatEur(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title={`Top fournisseurs ${currentYear}`}>
          {topSuppliersRaw.length === 0 ? (
            <Empty>Aucune facture fournisseur cette année.</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-neutral-100">
                {topSuppliersRaw.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">{r.supplierName ?? "?"}</td>
                    <td className="px-2 py-1.5 text-right text-xs text-neutral-500">
                      {r.n} fact.
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatEur(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          title="Banque"
          desc={`${qontoTotal} opérations · ${unmatchedCount} non rapprochées`}
          href="/banque"
        />
        <Card
          title="Relevés bancaires"
          desc={`${stmtsCount} PDF mensuels archivés sur Blob`}
          href="/banque/statements"
        />
        <Card
          title="Imports en attente"
          desc="PDF à drop pour extraction LLM"
          href="/invoices/import"
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs uppercase text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-neutral-500">{sub}</div> : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-medium text-neutral-700">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-xs text-neutral-500">{children}</p>;
}

function Card({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-400 hover:shadow-sm transition"
    >
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-neutral-600">{desc}</p>
    </Link>
  );
}
