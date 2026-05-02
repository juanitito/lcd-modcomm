"use client";

import { useState, useTransition } from "react";
import { splitTransaction } from "../_actions";
import {
  CLASSIFICATION_KINDS_BY_SIDE,
  type ClassificationKind,
} from "@/lib/accounting-kinds";

type InvoiceOption = { id: string; label: string };

type SplitTarget =
  | { type: "supplier_invoice"; id: string }
  | { type: "client_invoice"; id: string }
  | { type: "kind"; key: ClassificationKind };

type SplitRow = {
  amount: string;
  // Format encodé : "kind:owner_advance" | "supplier_invoice:<uuid>" | "client_invoice:<uuid>" | ""
  targetEncoded: string;
};

function decodeTarget(encoded: string): SplitTarget | null {
  if (!encoded) return null;
  const [type, rest] = encoded.split(":", 2);
  if (type === "kind") {
    return { type: "kind", key: rest as ClassificationKind };
  }
  if (type === "supplier_invoice" || type === "client_invoice") {
    return { type, id: rest };
  }
  return null;
}

export function SplitForm({
  txId,
  txAbsAmount,
  direction,
  invoiceOptions,
  supplierInvoiceOptions,
  onCancel,
}: {
  txId: string;
  txAbsAmount: number;
  direction: "credit" | "debit";
  invoiceOptions: InvoiceOption[];
  supplierInvoiceOptions: InvoiceOption[];
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<SplitRow[]>([
    { amount: txAbsAmount.toFixed(2), targetEncoded: "" },
    { amount: "", targetEncoded: "" },
  ]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const kinds = CLASSIFICATION_KINDS_BY_SIDE[direction];
  const invoiceTargets =
    direction === "credit" ? invoiceOptions : supplierInvoiceOptions;
  const invoicePrefix =
    direction === "credit" ? "client_invoice" : "supplier_invoice";

  const sum = rows.reduce((s, r) => {
    const n = Number(r.amount);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
  const balanced = Math.abs(sum - txAbsAmount) < 0.01;
  const allTargeted = rows.every((r) => r.targetEncoded);
  const allPositive = rows.every((r) => Number(r.amount) > 0);

  const update = (i: number, patch: Partial<SplitRow>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((rs) => [...rs, { amount: "", targetEncoded: "" }]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length > 2 ? rs.filter((_, idx) => idx !== i) : rs));

  const submit = () => {
    setError(null);
    const splits = rows
      .map((r) => ({
        amount: Number(r.amount),
        target: decodeTarget(r.targetEncoded),
      }))
      .filter((s): s is { amount: number; target: SplitTarget } => !!s.target);
    if (splits.length < 2) {
      setError("Au moins 2 splits requis.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await splitTransaction({ txId, splits });
        if (!res.ok) setError(res.error);
        else onCancel(); // ferme la zone, la page va revalidate
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50/40 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-indigo-900">
          Split d'écriture comptable — total à atteindre :{" "}
          <span className="tabular-nums">{txAbsAmount.toFixed(2)} €</span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="text-neutral-500 hover:text-neutral-900"
        >
          Annuler
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={row.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
              disabled={isPending}
              className="input w-28 text-right tabular-nums"
            />
            <span className="text-neutral-400">€ →</span>
            <select
              value={row.targetEncoded}
              onChange={(e) => update(i, { targetEncoded: e.target.value })}
              disabled={isPending}
              className="input flex-1 min-w-[20rem]"
            >
              <option value="">— choisir une destination —</option>
              {invoiceTargets.length > 0 ? (
                <optgroup
                  label={
                    direction === "credit"
                      ? "Encaissement facture client"
                      : "Paiement facture fournisseur"
                  }
                >
                  {invoiceTargets.map((o) => (
                    <option key={o.id} value={`${invoicePrefix}:${o.id}`}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {kinds.length > 0 ? (
                <optgroup label="Classification (sans facture)">
                  {kinds.map((k) => (
                    <option key={k.key} value={`kind:${k.key}`}>
                      {k.shortLabel}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {rows.length > 2 ? (
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={isPending}
                className="text-neutral-400 hover:text-red-600"
                aria-label="Retirer cette ligne"
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addRow}
          disabled={isPending}
          className="text-neutral-600 underline hover:text-neutral-900"
        >
          + ajouter une ligne
        </button>
        <span
          className={`tabular-nums ${
            balanced
              ? "text-emerald-700"
              : "text-amber-700"
          }`}
        >
          Σ {sum.toFixed(2)} / {txAbsAmount.toFixed(2)}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !balanced || !allTargeted || !allPositive}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {isPending ? "…" : "Valider le split"}
        </button>
      </div>

      {error ? (
        <div className="mt-2 text-xs text-red-600">{error}</div>
      ) : null}
    </div>
  );
}
