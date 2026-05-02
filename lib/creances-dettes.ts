// État des créances et dettes au 31/12 d'un exercice donné.
// Source de vérité = status de la facture : tout ce qui n'est pas "paid" à
// la date de clôture est ouvert. Le lettrage exhaustif via le module Banque
// fait foi.

import { and, asc, lte, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type OpenInvoice = {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  tierName: string;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  daysOld: number;
  daysOverdue: number | null; // null = pas d'échéance, sinon nbr jours après
};

export async function fetchOpenClientInvoices(
  closingDate: string,
): Promise<OpenInvoice[]> {
  const rows = await db
    .select({
      id: schema.invoices.id,
      number: schema.invoices.invoiceNumber,
      date: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      status: schema.invoices.status,
      totalHt: schema.invoices.totalHt,
      totalVat: schema.invoices.totalVat,
      totalTtc: schema.invoices.totalTtc,
      clientSnapshot: schema.invoices.clientSnapshot,
    })
    .from(schema.invoices)
    .where(
      and(
        lte(schema.invoices.issueDate, closingDate),
        ne(schema.invoices.status, "paid"),
        ne(schema.invoices.status, "cancelled"),
      ),
    )
    .orderBy(asc(schema.invoices.issueDate));

  const closing = new Date(closingDate);
  return rows.map((r) => {
    const issuedMs = new Date(r.date).getTime();
    const dueMs = r.dueDate ? new Date(r.dueDate).getTime() : null;
    const daysOld = Math.floor((closing.getTime() - issuedMs) / 86400000);
    const daysOverdue =
      dueMs != null
        ? Math.max(0, Math.floor((closing.getTime() - dueMs) / 86400000))
        : null;
    return {
      id: r.id,
      number: r.number,
      date: r.date,
      dueDate: r.dueDate,
      tierName: r.clientSnapshot?.name ?? "?",
      totalHt: Number(r.totalHt),
      totalVat: Number(r.totalVat),
      totalTtc: Number(r.totalTtc),
      daysOld,
      daysOverdue,
    };
  });
}

export async function fetchOpenSupplierInvoices(
  closingDate: string,
): Promise<OpenInvoice[]> {
  const rows = await db
    .select({
      id: schema.supplierInvoices.id,
      number: schema.supplierInvoices.supplierInvoiceNumber,
      date: schema.supplierInvoices.issueDate,
      dueDate: schema.supplierInvoices.dueDate,
      status: schema.supplierInvoices.status,
      totalHt: schema.supplierInvoices.totalHt,
      totalVat: schema.supplierInvoices.totalVat,
      totalTtc: schema.supplierInvoices.totalTtc,
      supplierSnapshot: schema.supplierInvoices.supplierSnapshot,
    })
    .from(schema.supplierInvoices)
    .where(
      and(
        lte(schema.supplierInvoices.issueDate, closingDate),
        ne(schema.supplierInvoices.status, "paid"),
        ne(schema.supplierInvoices.status, "cancelled"),
      ),
    )
    .orderBy(asc(schema.supplierInvoices.issueDate));

  const closing = new Date(closingDate);
  return rows.map((r) => {
    const issuedMs = new Date(r.date).getTime();
    const dueMs = r.dueDate ? new Date(r.dueDate).getTime() : null;
    const daysOld = Math.floor((closing.getTime() - issuedMs) / 86400000);
    const daysOverdue =
      dueMs != null
        ? Math.max(0, Math.floor((closing.getTime() - dueMs) / 86400000))
        : null;
    return {
      id: r.id,
      number: r.number,
      date: r.date,
      dueDate: r.dueDate,
      tierName: r.supplierSnapshot?.name ?? "?",
      totalHt: Number(r.totalHt),
      totalVat: Number(r.totalVat),
      totalTtc: Number(r.totalTtc),
      daysOld,
      daysOverdue,
    };
  });
}
