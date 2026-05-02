"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  setImportClient,
  setImportSupplier,
  materializeImport,
  deleteImport,
  retryExtraction,
} from "@/lib/invoice-import-actions";
import { formatEur } from "@/lib/format";

type ImportRecord = {
  id: string;
  pdfBlobUrl: string;
  sourceFilename: string | null;
  direction: "client" | "supplier";
  status: string;
  errorMessage: string | null;
  matchedClientId: string | null;
  matchedSupplierId: string | null;
  materializedInvoiceId: string | null;
  materializedSupplierInvoiceId: string | null;
  extracted: {
    legacyNumber?: string | null;
    issueDate?: string | null;
    clientGuess?: { name?: string | null; siret?: string | null } | null;
    totals?: { totalHt?: number; totalVat?: number; totalTtc?: number } | null;
    lines?: unknown[];
  } | null;
};

type Counterparty = { id: string; code: string; name: string };

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-700",
  extracted: "bg-blue-100 text-blue-700",
  needs_review: "bg-amber-100 text-amber-700",
  materialized: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export function ImportRow({
  imp,
  clients,
  suppliers,
}: {
  imp: ImportRecord;
  clients: Counterparty[];
  suppliers: Counterparty[];
}) {
  const isClient = imp.direction === "client";
  const matchedId = isClient ? imp.matchedClientId : imp.matchedSupplierId;
  const options = isClient ? clients : suppliers;
  const matched = matchedId ? options.find((o) => o.id === matchedId) : null;
  const counterpartyLabel = isClient ? "client" : "fournisseur";
  const counterpartyBasePath = isClient ? "/clients" : "/suppliers";

  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(matchedId ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ex = imp.extracted;
  const total = ex?.totals?.totalTtc;
  const linesCount = ex?.lines?.length ?? 0;

  const canMaterialize =
    imp.status !== "materialized" &&
    imp.status !== "failed" &&
    !!matchedId &&
    !!ex?.legacyNumber &&
    !!ex?.issueDate;

  const handleSelect = (newId: string) => {
    setSelectedId(newId);
    if (!newId || newId === matchedId) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        if (isClient) {
          await setImportClient({ importId: imp.id, clientId: newId });
        } else {
          await setImportSupplier({ importId: imp.id, supplierId: newId });
        }
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[imp.status] ?? "bg-neutral-100 text-neutral-700"}`}
            >
              {imp.status}
            </span>
            {ex?.legacyNumber ? (
              <span className="font-mono text-sm">{ex.legacyNumber}</span>
            ) : null}
            {ex?.issueDate ? (
              <span className="text-xs text-neutral-500">{ex.issueDate}</span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-neutral-500">
            {imp.sourceFilename ?? "—"}
          </p>
        </div>

        <div className="text-right text-sm tabular-nums">
          {total != null ? (
            <div className="font-medium">{formatEur(total)}</div>
          ) : null}
          {linesCount > 0 ? (
            <div className="text-xs text-neutral-500">
              {linesCount} ligne{linesCount > 1 ? "s" : ""}
            </div>
          ) : null}
        </div>
      </div>

      {imp.errorMessage ? (
        <p className="mt-2 text-xs text-red-600">{imp.errorMessage}</p>
      ) : null}

      {ex?.clientGuess?.name || ex?.clientGuess?.siret ? (
        <p className="mt-2 text-xs text-neutral-500">
          {isClient ? "Client" : "Fournisseur"} détecté sur le PDF :{" "}
          <span className="text-neutral-700">
            {ex.clientGuess.name ?? "?"}
            {ex.clientGuess.siret ? ` — SIRET ${ex.clientGuess.siret}` : ""}
          </span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {matched && !editing ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">{counterpartyLabel} :</span>
            <Link
              href={`${counterpartyBasePath}/${matched.id}`}
              className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs hover:border-neutral-400"
            >
              <span className="font-mono text-neutral-500">{matched.code}</span>{" "}
              <span className="text-neutral-800">{matched.name}</span>
              <span className="ml-1 text-neutral-400">→ éditer</span>
            </Link>
            {imp.status !== "materialized" ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={isPending}
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                changer
              </button>
            ) : null}
          </div>
        ) : (
          <select
            value={selectedId}
            onChange={(e) => handleSelect(e.target.value)}
            disabled={imp.status === "materialized" || isPending}
            className="input max-w-xs"
            autoFocus={editing}
          >
            <option value="">— matcher un {counterpartyLabel} —</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        )}

        <a
          href={imp.pdfBlobUrl}
          target="_blank"
          rel="noopener"
          className="text-xs text-neutral-600 underline hover:text-neutral-900"
        >
          Voir le PDF
        </a>

        <div className="ml-auto flex items-center gap-2">
          {imp.status === "failed" ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    await retryExtraction(imp.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                });
              }}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:border-neutral-500 disabled:opacity-50"
            >
              {isPending ? "…" : "Retenter l'extraction"}
            </button>
          ) : null}
          {imp.status === "materialized" ? (
            <span className="text-xs text-emerald-700">✓ matérialisé</span>
          ) : imp.status !== "failed" ? (
            <button
              type="button"
              disabled={!canMaterialize || isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    await materializeImport(imp.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                });
              }}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {isPending ? "…" : "Matérialiser"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (!confirm("Supprimer cet import ?")) return;
              setError(null);
              startTransition(async () => {
                try {
                  await deleteImport(imp.id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              });
            }}
            className="text-xs text-neutral-400 hover:text-red-600"
            aria-label="Supprimer"
          >
            ✕
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
