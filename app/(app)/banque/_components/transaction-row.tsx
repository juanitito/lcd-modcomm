"use client";

import { useState, useTransition } from "react";
import {
  setManualMatch,
  setManualSupplierMatch,
  clearMatch,
  classifyAsOwnerAdvance,
} from "../_actions";
import { formatEur } from "@/lib/format";

type TxRow = {
  id: string;
  date: string;
  settledAt: string | null;
  amount: string;
  currency: string;
  label: string | null;
  counterpartyName: string | null;
  qontoCategory: string | null;
  matchedInvoiceId: string | null;
  matchedInvoiceNumber: string | null;
  matchedInvoiceTotal: string | null;
  matchedSupplierInvoiceId: string | null;
  matchedSupplierInvoiceNumber: string | null;
  matchedSupplierInvoiceTotal: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  journalEntryLabel: string | null;
  matchNote: string | null;
};

type InvoiceOption = { id: string; label: string };

export function TransactionRow({
  tx,
  invoiceOptions,
  supplierInvoiceOptions,
}: {
  tx: TxRow;
  invoiceOptions: InvoiceOption[];
  supplierInvoiceOptions: InvoiceOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const amount = Number(tx.amount);
  const isCredit = amount >= 0;
  const dateLabel = tx.settledAt
    ? new Date(tx.settledAt).toLocaleDateString("fr-FR")
    : new Date(tx.date).toLocaleDateString("fr-FR");

  const isInvoiceMatched =
    tx.matchedInvoiceId || tx.matchedSupplierInvoiceId;
  const isClassified = !!tx.journalEntryId;
  const isTraced = isInvoiceMatched || isClassified;
  const matchedNumber =
    tx.matchedInvoiceNumber ?? tx.matchedSupplierInvoiceNumber;
  const matchedTotal =
    tx.matchedInvoiceTotal ?? tx.matchedSupplierInvoiceTotal;

  const mismatch =
    isInvoiceMatched && matchedTotal
      ? Math.abs(Number(matchedTotal) - Math.abs(amount)) > 0.01
      : false;

  return (
    <tr>
      <td className="px-3 py-2 text-xs text-neutral-600 tabular-nums">
        {dateLabel}
      </td>
      <td className="px-3 py-2">
        <div>{tx.counterpartyName ?? tx.label ?? "—"}</div>
        {tx.label && tx.label !== tx.counterpartyName ? (
          <div className="text-xs text-neutral-500">{tx.label}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-xs text-neutral-500">
        {tx.qontoCategory ?? "—"}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums font-medium ${
          isCredit ? "text-emerald-700" : "text-neutral-700"
        }`}
      >
        {isCredit ? "+" : ""}
        {formatEur(amount)}
      </td>
      <td className="px-3 py-2">
        {isTraced ? (
          <div className="flex items-center gap-2">
            {isInvoiceMatched ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                ✓ {matchedNumber}
              </span>
            ) : (
              <span
                className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                title={tx.journalEntryLabel ?? undefined}
              >
                ✓ Avance CCA · {tx.journalEntryNumber}
              </span>
            )}
            {mismatch ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                ⚠ écart montant
              </span>
            ) : null}
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                const msg = isClassified
                  ? "Annuler la classification ? L'écriture comptable sera supprimée."
                  : "Annuler ce rapprochement ?";
                if (!confirm(msg)) return;
                startTransition(async () => {
                  try {
                    await clearMatch(tx.id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                });
              }}
              className="text-xs text-neutral-400 hover:text-red-600"
              aria-label="Délier"
            >
              ✕
            </button>
            {tx.matchNote ? (
              <span className="text-xs text-neutral-400">{tx.matchNote}</span>
            ) : null}
          </div>
        ) : isCredit ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              disabled={isPending}
              defaultValue=""
              onChange={(e) => {
                const invoiceId = e.target.value;
                if (!invoiceId) return;
                setError(null);
                startTransition(async () => {
                  try {
                    await setManualMatch({ txId: tx.id, invoiceId });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                });
              }}
              className="input max-w-md text-xs"
            >
              <option value="">— rapprocher avec une facture client —</option>
              {invoiceOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (
                  !confirm(
                    "Classer comme avance en compte courant d'associé ?\nCréera l'écriture : 512 (débit) / 455 (crédit).",
                  )
                ) {
                  return;
                }
                setError(null);
                startTransition(async () => {
                  try {
                    const res = await classifyAsOwnerAdvance(tx.id);
                    if (!res.ok) setError(res.error);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                });
              }}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:border-indigo-500 disabled:opacity-50"
              title="Avance en compte courant d'associé : Débit 512 / Crédit 455"
            >
              Avance assoc.
            </button>
          </div>
        ) : (
          <select
            disabled={isPending}
            defaultValue=""
            onChange={(e) => {
              const supplierInvoiceId = e.target.value;
              if (!supplierInvoiceId) return;
              setError(null);
              startTransition(async () => {
                try {
                  await setManualSupplierMatch({
                    txId: tx.id,
                    supplierInvoiceId,
                  });
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              });
            }}
            className="input max-w-md text-xs"
          >
            <option value="">
              {supplierInvoiceOptions.length === 0
                ? "— pas encore de factures fournisseurs —"
                : "— rapprocher avec une facture fournisseur —"}
            </option>
            {supplierInvoiceOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {error ? <div className="text-xs text-red-600">{error}</div> : null}
      </td>
    </tr>
  );
}
