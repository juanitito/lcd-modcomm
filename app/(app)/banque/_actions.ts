"use server";

import { and, eq, isNull, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import {
  CLASSIFICATION_KINDS,
  type ClassificationKind,
  deleteJournalEntry,
  ensurePcgAccountsExist,
  getOrCreatePeriodForDate,
  nextEntryNumber,
} from "@/lib/accounting";
import { getOrganization, iterateTransactions, toQontoRow } from "@/lib/qonto";
import { nameMatchScore } from "@/lib/text-match";

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

  const unmatchedAll = await db
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
        isNull(schema.qontoTransactions.matchedInvoiceId),
        isNull(schema.qontoTransactions.matchedSupplierInvoiceId),
      ),
    );

  const [allClientInvoices, allSupplierInvoices] = await Promise.all([
    db
      .select({
        id: schema.invoices.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        issueDate: schema.invoices.issueDate,
        totalTtc: schema.invoices.totalTtc,
        clientSnapshot: schema.invoices.clientSnapshot,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.status, "issued")),
    db
      .select({
        id: schema.supplierInvoices.id,
        supplierInvoiceNumber: schema.supplierInvoices.supplierInvoiceNumber,
        issueDate: schema.supplierInvoices.issueDate,
        totalTtc: schema.supplierInvoices.totalTtc,
        supplierSnapshot: schema.supplierInvoices.supplierSnapshot,
      })
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.status, "issued")),
  ]);

  let matched = 0;
  let ambiguous = 0;

  for (const tx of unmatchedAll) {
    const txAmount = Number(tx.amount);
    if (!Number.isFinite(txAmount) || txAmount === 0) continue;

    const isCredit = txAmount > 0;
    const absAmount = Math.abs(txAmount);
    const refMs = (tx.settledAt ?? new Date(tx.date)).getTime();
    const fromMs = refMs - DATE_WINDOW_DAYS * ONE_DAY_MS;
    const toMs = refMs + DATE_WINDOW_DAYS * ONE_DAY_MS;
    const counterparty = tx.counterpartyName ?? tx.label ?? "";

    if (isCredit) {
      const candidates = allClientInvoices
        .filter((inv) => {
          const total = Number(inv.totalTtc);
          if (!Number.isFinite(total)) return false;
          if (Math.abs(total - absAmount) > AMOUNT_TOLERANCE) return false;
          const issueMs = new Date(inv.issueDate).getTime();
          return issueMs >= fromMs && issueMs <= toMs;
        })
        .map((inv) => ({
          inv,
          score: nameMatchScore(inv.clientSnapshot?.name ?? "", counterparty),
        }))
        .sort((a, b) => b.score - a.score);

      if (candidates.length === 0) continue;
      const top = candidates[0];
      if (top.score < NAME_MATCH_THRESHOLD) continue;
      const second = candidates[1];
      if (second && second.score >= top.score - NAME_TIE_MARGIN) {
        ambiguous++;
        continue;
      }

      await db
        .update(schema.qontoTransactions)
        .set({
          matchedInvoiceId: top.inv.id,
          matchedAt: new Date(),
          matchNote: `Auto-match client (score nom ${top.score.toFixed(2)})`,
        })
        .where(eq(schema.qontoTransactions.id, tx.id));
      matched++;
    } else {
      const candidates = allSupplierInvoices
        .filter((si) => {
          const total = Number(si.totalTtc);
          if (!Number.isFinite(total)) return false;
          if (Math.abs(total - absAmount) > AMOUNT_TOLERANCE) return false;
          const issueMs = new Date(si.issueDate).getTime();
          return issueMs >= fromMs && issueMs <= toMs;
        })
        .map((si) => ({
          si,
          score: nameMatchScore(si.supplierSnapshot?.name ?? "", counterparty),
        }))
        .sort((a, b) => b.score - a.score);

      if (candidates.length === 0) continue;
      const top = candidates[0];
      if (top.score < NAME_MATCH_THRESHOLD) continue;
      const second = candidates[1];
      if (second && second.score >= top.score - NAME_TIE_MARGIN) {
        ambiguous++;
        continue;
      }

      await db
        .update(schema.qontoTransactions)
        .set({
          matchedSupplierInvoiceId: top.si.id,
          matchedAt: new Date(),
          matchNote: `Auto-match fournisseur (score nom ${top.score.toFixed(2)})`,
        })
        .where(eq(schema.qontoTransactions.id, tx.id));
      matched++;
    }
  }

  revalidatePath("/banque");
  return { matched, scanned: unmatchedAll.length, ambiguous };
}

// ---------- Manual match / unmatch ----------

const matchClientSchema = z.object({
  txId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

const matchSupplierSchema = z.object({
  txId: z.string().uuid(),
  supplierInvoiceId: z.string().uuid(),
});

export async function setManualMatch(input: { txId: string; invoiceId: string }) {
  await requireAuth();
  const data = matchClientSchema.parse(input);

  await db
    .update(schema.qontoTransactions)
    .set({
      matchedInvoiceId: data.invoiceId,
      matchedSupplierInvoiceId: null,
      matchedAt: new Date(),
      matchNote: "Match manuel client",
    })
    .where(eq(schema.qontoTransactions.id, data.txId));

  revalidatePath("/banque");
}

export async function setManualSupplierMatch(input: {
  txId: string;
  supplierInvoiceId: string;
}) {
  await requireAuth();
  const data = matchSupplierSchema.parse(input);

  await db
    .update(schema.qontoTransactions)
    .set({
      matchedSupplierInvoiceId: data.supplierInvoiceId,
      matchedInvoiceId: null,
      matchedAt: new Date(),
      matchNote: "Match manuel fournisseur",
    })
    .where(eq(schema.qontoTransactions.id, data.txId));

  revalidatePath("/banque");
}

const idSchema = z.string().uuid();

export async function clearMatch(txId: string) {
  await requireAuth();
  const id = idSchema.parse(txId);

  // Si la transaction était classée (écriture comptable non-facture), on la
  // débranche aussi et on supprime l'écriture associée.
  const tx = await db.query.qontoTransactions.findFirst({
    where: eq(schema.qontoTransactions.id, id),
    columns: { journalEntryId: true },
  });

  await db
    .update(schema.qontoTransactions)
    .set({
      matchedInvoiceId: null,
      matchedSupplierInvoiceId: null,
      matchedSupplierOrderId: null,
      journalEntryId: null,
      matchedAt: null,
      matchNote: null,
    })
    .where(eq(schema.qontoTransactions.id, id));

  if (tx?.journalEntryId) {
    await deleteJournalEntry(tx.journalEntryId);
  }

  revalidatePath("/banque");
}

// ---------- Classification non-facture (multi-kinds) ----------

export type ActionResult = { ok: true } | { ok: false; error: string };

const classifySchema = z.object({
  txId: z.string().uuid(),
  kind: z.enum(
    Object.keys(CLASSIFICATION_KINDS) as [
      ClassificationKind,
      ...ClassificationKind[],
    ],
  ),
});

export async function classifyTransaction(input: {
  txId: string;
  kind: ClassificationKind;
}): Promise<ActionResult> {
  await requireAuth();
  const data = classifySchema.parse(input);
  const def = CLASSIFICATION_KINDS[data.kind];

  const tx = await db.query.qontoTransactions.findFirst({
    where: eq(schema.qontoTransactions.id, data.txId),
  });
  if (!tx) return { ok: false, error: "Transaction introuvable." };
  if (tx.matchedInvoiceId || tx.matchedSupplierInvoiceId) {
    return { ok: false, error: "Transaction déjà rapprochée à une facture." };
  }
  if (tx.journalEntryId) {
    return { ok: false, error: "Transaction déjà classée." };
  }
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, error: "Montant invalide." };
  }
  if (def.side === "credit" && amount <= 0) {
    return {
      ok: false,
      error: `${def.label} : attendu un crédit (montant > 0).`,
    };
  }
  if (def.side === "debit" && amount >= 0) {
    return {
      ok: false,
      error: `${def.label} : attendu un débit (montant < 0).`,
    };
  }

  await ensurePcgAccountsExist();

  const txDate = tx.settledAt ?? new Date(tx.date);
  const period = await getOrCreatePeriodForDate(txDate);
  const entryNumber = await nextEntryNumber(txDate, "BQ");

  const counterparty = tx.counterpartyName ?? tx.label ?? "—";
  const label = `${def.label} — ${counterparty}`;
  const dateIso = txDate.toISOString().slice(0, 10);
  const absAmountStr = Math.abs(amount).toFixed(2);

  const [entry] = await db
    .insert(schema.journalEntries)
    .values({
      periodId: period.id,
      entryNumber,
      date: dateIso,
      journal: "BQ",
      label,
      status: "draft",
    })
    .returning({ id: schema.journalEntries.id });

  await db.insert(schema.journalLines).values([
    {
      entryId: entry.id,
      accountCode: def.debit,
      label,
      debit: absAmountStr,
      credit: "0.00",
      position: 0,
    },
    {
      entryId: entry.id,
      accountCode: def.credit,
      label,
      debit: "0.00",
      credit: absAmountStr,
      position: 1,
    },
  ]);

  await db
    .update(schema.qontoTransactions)
    .set({
      journalEntryId: entry.id,
      matchedAt: new Date(),
      matchNote: `Classé : ${def.shortLabel} (${def.debit}/${def.credit})`,
    })
    .where(eq(schema.qontoTransactions.id, data.txId));

  revalidatePath("/banque");
  return { ok: true };
}

// ---------- Split d'une transaction sur plusieurs destinations ----------

const splitTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("supplier_invoice"), id: z.string().uuid() }),
  z.object({ type: z.literal("client_invoice"), id: z.string().uuid() }),
  z.object({
    type: z.literal("kind"),
    key: z.enum(
      Object.keys(CLASSIFICATION_KINDS) as [
        ClassificationKind,
        ...ClassificationKind[],
      ],
    ),
  }),
]);

const splitSchema = z.object({
  txId: z.string().uuid(),
  splits: z
    .array(
      z.object({
        amount: z.number().positive(),
        target: splitTargetSchema,
      }),
    )
    .min(2),
});

export async function splitTransaction(input: {
  txId: string;
  splits: Array<{
    amount: number;
    target:
      | { type: "supplier_invoice"; id: string }
      | { type: "client_invoice"; id: string }
      | { type: "kind"; key: ClassificationKind };
  }>;
}): Promise<ActionResult> {
  await requireAuth();
  const data = splitSchema.parse(input);

  const tx = await db.query.qontoTransactions.findFirst({
    where: eq(schema.qontoTransactions.id, data.txId),
  });
  if (!tx) return { ok: false, error: "Transaction introuvable." };
  if (tx.matchedInvoiceId || tx.matchedSupplierInvoiceId || tx.journalEntryId) {
    return {
      ok: false,
      error: "Transaction déjà rapprochée ou classée — délier d'abord.",
    };
  }

  const txAmount = Number(tx.amount);
  if (!Number.isFinite(txAmount) || txAmount === 0) {
    return { ok: false, error: "Montant transaction invalide." };
  }
  const txAbs = Math.abs(txAmount);
  const direction: "credit" | "debit" = txAmount > 0 ? "credit" : "debit";

  const sumSplits = data.splits.reduce((s, x) => s + x.amount, 0);
  if (Math.abs(sumSplits - txAbs) > 0.01) {
    return {
      ok: false,
      error: `Somme des splits ${sumSplits.toFixed(2)} ≠ |montant tx| ${txAbs.toFixed(2)}.`,
    };
  }

  // Préparer les lignes : pour chaque split, déterminer le compte non-512
  // (l'autre compte de la classification ou 401/411 selon la cible facture).
  type LineSpec = {
    accountCode: string;
    label: string;
    matchedInvoiceId: string | null;
    matchedSupplierInvoiceId: string | null;
    amount: number;
  };

  const lineSpecs: LineSpec[] = [];
  for (const s of data.splits) {
    if (s.target.type === "supplier_invoice") {
      // Sur paiement fournisseur : tx debit, compte 401 débité.
      if (direction !== "debit") {
        return {
          ok: false,
          error: "Un paiement fournisseur doit être sur une tx débit.",
        };
      }
      const inv = await db.query.supplierInvoices.findFirst({
        where: eq(schema.supplierInvoices.id, s.target.id),
      });
      if (!inv) {
        return { ok: false, error: `Facture fournisseur ${s.target.id} introuvable.` };
      }
      lineSpecs.push({
        accountCode: "401",
        label: `Paiement facture ${inv.supplierInvoiceNumber}`,
        matchedInvoiceId: null,
        matchedSupplierInvoiceId: inv.id,
        amount: s.amount,
      });
    } else if (s.target.type === "client_invoice") {
      if (direction !== "credit") {
        return {
          ok: false,
          error: "Un encaissement client doit être sur une tx crédit.",
        };
      }
      const inv = await db.query.invoices.findFirst({
        where: eq(schema.invoices.id, s.target.id),
      });
      if (!inv) {
        return { ok: false, error: `Facture client ${s.target.id} introuvable.` };
      }
      lineSpecs.push({
        accountCode: "411",
        label: `Encaissement facture ${inv.invoiceNumber}`,
        matchedInvoiceId: inv.id,
        matchedSupplierInvoiceId: null,
        amount: s.amount,
      });
    } else {
      const def = CLASSIFICATION_KINDS[s.target.key];
      if (def.side !== direction) {
        return {
          ok: false,
          error: `Le kind ${def.label} demande un sens ${def.side}, tx en ${direction}.`,
        };
      }
      // Compte non-512 : si tx débit, c'est def.debit ; si tx crédit, c'est
      // def.credit. (L'autre côté est toujours 512 par construction de nos
      // kinds actuels — assertions visuelles dans accounting-kinds.ts.)
      const counterAccount = direction === "debit" ? def.debit : def.credit;
      lineSpecs.push({
        accountCode: counterAccount,
        label: def.label,
        matchedInvoiceId: null,
        matchedSupplierInvoiceId: null,
        amount: s.amount,
      });
    }
  }

  await ensurePcgAccountsExist();

  const txDate = tx.settledAt ?? new Date(tx.date);
  const period = await getOrCreatePeriodForDate(txDate);
  const entryNumber = await nextEntryNumber(txDate, "BQ");
  const counterparty = tx.counterpartyName ?? tx.label ?? "—";
  const entryLabel = `Split — ${counterparty}`;
  const dateIso = txDate.toISOString().slice(0, 10);

  const [entry] = await db
    .insert(schema.journalEntries)
    .values({
      periodId: period.id,
      entryNumber,
      date: dateIso,
      journal: "BQ",
      label: entryLabel,
      status: "draft",
    })
    .returning({ id: schema.journalEntries.id });

  // Lignes ventilation (côté opposé à 512) puis ligne 512 récapitulative.
  const lineRows = lineSpecs.map((spec, i) => ({
    entryId: entry.id,
    accountCode: spec.accountCode,
    label: spec.label,
    debit: direction === "debit" ? spec.amount.toFixed(2) : "0.00",
    credit: direction === "debit" ? "0.00" : spec.amount.toFixed(2),
    position: i,
    matchedInvoiceId: spec.matchedInvoiceId,
    matchedSupplierInvoiceId: spec.matchedSupplierInvoiceId,
  }));
  lineRows.push({
    entryId: entry.id,
    accountCode: "512",
    label: entryLabel,
    debit: direction === "debit" ? "0.00" : txAbs.toFixed(2),
    credit: direction === "debit" ? txAbs.toFixed(2) : "0.00",
    position: lineSpecs.length,
    matchedInvoiceId: null,
    matchedSupplierInvoiceId: null,
  });
  await db.insert(schema.journalLines).values(lineRows);

  // Lier la tx à l'écriture.
  await db
    .update(schema.qontoTransactions)
    .set({
      journalEntryId: entry.id,
      matchedAt: new Date(),
      matchNote: `Split ${data.splits.length} ligne(s)`,
    })
    .where(eq(schema.qontoTransactions.id, data.txId));

  // Marquer chaque facture liée comme payée si le split = total.
  for (const spec of lineSpecs) {
    if (spec.matchedSupplierInvoiceId) {
      const inv = await db.query.supplierInvoices.findFirst({
        where: eq(schema.supplierInvoices.id, spec.matchedSupplierInvoiceId),
        columns: { id: true, totalTtc: true, status: true },
      });
      if (inv && Math.abs(Number(inv.totalTtc) - spec.amount) < 0.01) {
        await db
          .update(schema.supplierInvoices)
          .set({ status: "paid" })
          .where(eq(schema.supplierInvoices.id, inv.id));
      }
    }
    if (spec.matchedInvoiceId) {
      const inv = await db.query.invoices.findFirst({
        where: eq(schema.invoices.id, spec.matchedInvoiceId),
        columns: { id: true, totalTtc: true, status: true },
      });
      if (inv && Math.abs(Number(inv.totalTtc) - spec.amount) < 0.01) {
        await db
          .update(schema.invoices)
          .set({ status: "paid" })
          .where(eq(schema.invoices.id, inv.id));
      }
    }
  }

  revalidatePath("/banque");
  return { ok: true };
}
