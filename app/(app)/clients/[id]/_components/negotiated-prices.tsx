"use client";

import { useState, useTransition } from "react";
import { formatEurUnit, formatPct, marginPct } from "@/lib/format";
import { setClientPrice, removeClientPrice } from "../_actions";

type Row = {
  productId: string;
  code: string;
  designation: string;
  conditionnement: string | null;
  purchasePriceHt: string;
  defaultSalePriceHt: string;
  salePriceHt: string;
  marginPct: string | null;
  notes: string | null;
};

type ProductOption = {
  id: string;
  code: string;
  designation: string;
  purchasePriceHt: string;
  defaultSalePriceHt: string;
};

export function NegotiatedPrices({
  clientId,
  rows,
  productOptions,
}: {
  clientId: string;
  rows: Row[];
  productOptions: ProductOption[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-neutral-700">Tarifs négociés</h2>
          <p className="text-xs text-neutral-500">
            Prix spécifiques à ce client. La marge est libre — saisir le prix
            de vente HT négocié.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs text-neutral-600 hover:text-neutral-900"
        >
          + ajouter un produit
        </button>
      </div>

      {rows.length === 0 && !adding ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          Aucun tarif négocié pour ce client.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2 font-medium">Code</th>
              <th className="px-2 py-2 font-medium">Désignation</th>
              <th className="px-2 py-2 font-medium text-right">PA HT</th>
              <th className="px-2 py-2 font-medium text-right">PDV défaut</th>
              <th className="px-2 py-2 font-medium text-right">PDV négocié</th>
              <th className="px-2 py-2 font-medium text-right">Marge</th>
              <th className="px-2 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <PriceRow key={r.productId} clientId={clientId} row={r} />
            ))}
            {adding ? (
              <AddRow
                clientId={clientId}
                productOptions={productOptions.filter(
                  (p) => !rows.some((r) => r.productId === p.id),
                )}
                onDone={() => setAdding(false)}
              />
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PriceRow({ clientId, row }: { clientId: string; row: Row }) {
  const [value, setValue] = useState(row.salePriceHt);
  const [isPending, startTransition] = useTransition();
  const dirty = value !== row.salePriceHt;
  const m = marginPct(row.purchasePriceHt, value);

  return (
    <tr>
      <td className="px-2 py-2 font-mono text-xs">{row.code}</td>
      <td className="px-2 py-2">
        {row.designation}
        {row.conditionnement ? (
          <span className="ml-1 text-xs text-neutral-500">
            ({row.conditionnement})
          </span>
        ) : null}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
        {formatEurUnit(row.purchasePriceHt)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
        {formatEurUnit(row.defaultSalePriceHt)}
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="number"
          step="0.0001"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input w-28 text-right tabular-nums"
        />
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {m === null ? "—" : formatPct(m)}
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await setClientPrice({
                    clientId,
                    productId: row.productId,
                    salePriceHt: value,
                  });
                })
              }
              className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {isPending ? "…" : "Enregistrer"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (!confirm(`Supprimer le tarif négocié pour ${row.code} ?`)) return;
              startTransition(async () => {
                await removeClientPrice({
                  clientId,
                  productId: row.productId,
                });
              });
            }}
            className="text-xs text-neutral-400 hover:text-red-600"
            aria-label="Supprimer"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddRow({
  clientId,
  productOptions,
  onDone,
}: {
  clientId: string;
  productOptions: ProductOption[];
  onDone: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [isPending, startTransition] = useTransition();
  const product = productOptions.find((p) => p.id === productId);
  const m = product ? marginPct(product.purchasePriceHt, price) : null;

  return (
    <tr className="bg-neutral-50">
      <td className="px-2 py-2" colSpan={2}>
        <select
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            const p = productOptions.find((x) => x.id === e.target.value);
            if (p) setPrice(p.defaultSalePriceHt);
          }}
          className="input"
        >
          <option value="">— choisir un produit —</option>
          {productOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.designation}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
        {product ? formatEurUnit(product.purchasePriceHt) : "—"}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
        {product ? formatEurUnit(product.defaultSalePriceHt) : "—"}
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="number"
          step="0.0001"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          disabled={!product}
          className="input w-28 text-right tabular-nums"
        />
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {m === null ? "—" : formatPct(m)}
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={!product || !price || isPending}
            onClick={() =>
              startTransition(async () => {
                await setClientPrice({
                  clientId,
                  productId,
                  salePriceHt: price,
                });
                onDone();
              })
            }
            className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "…" : "Ajouter"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="text-xs text-neutral-400 hover:text-neutral-700"
          >
            annuler
          </button>
        </div>
      </td>
    </tr>
  );
}
