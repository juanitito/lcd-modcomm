"use server";

import { and, eq, isNull, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { getOrganization, iterateTransactions, toQontoRow } from "@/lib/qonto";

// ---------- Sync ----------

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function syncQonto(): Promise<{
  newCount: number;
  updatedCount: number;
  accounts: number;
}> {
  await requireAuth();

  const { organization } = await getOrganization();
  const accounts = organization.bank_accounts.filter(
    (a) => a.status !== "closed",
  );

  // Date de départ : max(settled_at) connu - 1 jour de marge, sinon 2 ans
  const lastRow = await db
    .select({ max: max(schema.qontoTransactions.settledAt) })
    .from(schema.qontoTransactions);
  const lastSettled = lastRow[0]?.max ?? null;
  const fromDate = lastSettled
    ? new Date(lastSettled.getTime() - ONE_DAY_MS)
    : new Date(Date.now() - TWO_YEARS_MS);
  const sinceIso = fromDate.toISOString();

  let newCount = 0;
  let updatedCount = 0;

  for (const account of accounts) {
    for await (const batch of iterateTransactions({
      bankAccountId: account.id,
      settledAtFrom: sinceIso,
    })) {
      for (const tx of batch) {
        if (!tx.settled_at) continue; // skip pending/declined
        const row = toQontoRow(tx);
        const existing = await db.query.qontoTransactions.findFirst({
          where: eq(schema.qontoTransactions.qontoId, row.qontoId),
        });
        if (existing) {
          await db
            .update(schema.qontoTransactions)
            .set(row)
            .where(eq(schema.qontoTransactions.id, existing.id));
          updatedCount++;
        } else {
          await db.insert(schema.qontoTransactions).values(row);
          newCount++;
        }
      }
    }
  }

  revalidatePath("/banque");
  return { newCount, updatedCount, accounts: accounts.length };
}

// ---------- Auto-match income transactions to outgoing invoices ----------

function normalizeTokens(s: string): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritics
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function tokenOverlap(a: string, b: string): number {
  const ta = normalizeTokens(a);
  const tb = normalizeTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

const NAME_MATCH_THRESHOLD = 0.5;
const NAME_TIE_MARGIN = 0.1;
const AMOUNT_TOLERANCE = 0.01;
const DATE_WINDOW_DAYS = 90;

export async function autoMatchTransactions(): Promise<{
  matched: number;
  scanned: number;
  ambiguous: number;
}> {
  await requireAuth();

  const unmatched = await db
    .select({
      id: schema.qontoTransactions.id,
      amount: schema.qontoTransactions.amount,
      settledAt: schema.qontoTransactions.settledAt,
      date: schema.qontoTransactions.date,
      counterpartyName: schema.qontoTransactions.counterpartyName,
      label: schema.qontoTransactions.label,
    })
    .from(schema.qontoTransactions)
    .where(
      and(
        sql`${schema.qontoTransactions.amount}::numeric > 0`,
        isNull(schema.qontoTransactions.matchedInvoiceId),
      ),
    );

  // Pré-charge toutes les invoices émises (volume faible : ~20 historiques + à venir)
  const allInvoices = await db
    .select({
      id: schema.invoices.id,
      invoiceNumber: schema.invoices.invoiceNumber,
      issueDate: schema.invoices.issueDate,
      totalTtc: schema.invoices.totalTtc,
      clientSnapshot: schema.invoices.clientSnapshot,
      status: schema.invoices.status,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.status, "issued"));

  let matched = 0;
  let ambiguous = 0;

  for (const tx of unmatched) {
    const txAmount = Number(tx.amount);
    if (!Number.isFinite(txAmount) || txAmount <= 0) continue;

    const refMs = (tx.settledAt ?? new Date(tx.date)).getTime();
    const fromMs = refMs - DATE_WINDOW_DAYS * ONE_DAY_MS;
    const toMs = refMs + DATE_WINDOW_DAYS * ONE_DAY_MS;
    const counterparty = tx.counterpartyName ?? tx.label ?? "";

    const candidates = allInvoices
      .filter((inv) => {
        const total = Number(inv.totalTtc);
        if (!Number.isFinite(total)) return false;
        if (Math.abs(total - txAmount) > AMOUNT_TOLERANCE) return false;
        const issueMs = new Date(inv.issueDate).getTime();
        return issueMs >= fromMs && issueMs <= toMs;
      })
      .map((inv) => ({
        inv,
        score: tokenOverlap(inv.clientSnapshot?.name ?? "", counterparty),
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) continue;
    const top = candidates[0];
    if (top.score < NAME_MATCH_THRESHOLD) continue;
    const second = candidates[1];
    if (second && second.score >= top.score - NAME_TIE_MARGIN) {
      // Ambigu : 2+ candidats à score équivalent → on laisse manuel
      ambiguous++;
      continue;
    }

    await db
      .update(schema.qontoTransactions)
      .set({
        matchedInvoiceId: top.inv.id,
        matchedAt: new Date(),
        matchNote: `Auto-match (score nom ${top.score.toFixed(2)})`,
      })
      .where(eq(schema.qontoTransactions.id, tx.id));
    matched++;
  }

  revalidatePath("/banque");
  return { matched, scanned: unmatched.length, ambiguous };
}

// ---------- Manual match / unmatch ----------

const setSchema = z.object({
  txId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

export async function setManualMatch(input: { txId: string; invoiceId: string }) {
  await requireAuth();
  const data = setSchema.parse(input);

  await db
    .update(schema.qontoTransactions)
    .set({
      matchedInvoiceId: data.invoiceId,
      matchedAt: new Date(),
      matchNote: "Match manuel",
    })
    .where(eq(schema.qontoTransactions.id, data.txId));

  revalidatePath("/banque");
}

const idSchema = z.string().uuid();

export async function clearMatch(txId: string) {
  await requireAuth();
  const id = idSchema.parse(txId);

  await db
    .update(schema.qontoTransactions)
    .set({
      matchedInvoiceId: null,
      matchedSupplierOrderId: null,
      matchedAt: null,
      matchNote: null,
    })
    .where(eq(schema.qontoTransactions.id, id));

  revalidatePath("/banque");
}
