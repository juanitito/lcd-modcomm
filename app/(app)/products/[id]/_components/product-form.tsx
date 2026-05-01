"use client";

import { useTransition } from "react";

type Supplier = { code: string; name: string };
type Family = { code: string; label: string };

type Initial = {
  code?: string;
  designation?: string | null;
  conditionnement?: string | null;
  moq?: string | null;
  supplierCode?: string | null;
  familyCode?: string | null;
  purchasePriceHt?: string | null;
  defaultSalePriceHt?: string | null;
  vatRate?: string | null;
  ftUrl?: string | null;
  fdsUrl?: string | null;
  pictureUrl?: string | null;
  weightKg?: string | null;
  volumeL?: string | null;
  active?: boolean;
};

export function ProductForm({
  initial,
  suppliers,
  families,
  vatRates,
  action,
  mode,
}: {
  initial: Initial;
  suppliers: Supplier[];
  families: Family[];
  vatRates: { rate: string; label: string }[];
  action: (formData: FormData) => Promise<void>;
  mode: "edit" | "create";
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => startTransition(() => action(fd))}
      className="grid gap-6"
    >
      <Section title="Identification">
        <Field label="Code" required>
          <input
            name="code"
            defaultValue={initial.code ?? ""}
            disabled={mode === "edit"}
            required
            className="input font-mono"
          />
        </Field>
        <Field label="Désignation" required wide>
          <input
            name="designation"
            defaultValue={initial.designation ?? ""}
            required
            className="input"
          />
        </Field>
        <Field label="Conditionnement">
          <input
            name="conditionnement"
            defaultValue={initial.conditionnement ?? ""}
            className="input"
          />
        </Field>
        <Field label="MOQ">
          <input name="moq" defaultValue={initial.moq ?? ""} className="input" />
        </Field>
      </Section>

      <Section title="Classification">
        <Field label="Fournisseur">
          <select
            name="supplierCode"
            defaultValue={initial.supplierCode ?? ""}
            className="input"
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Famille produit">
          <select
            name="familyCode"
            defaultValue={initial.familyCode ?? ""}
            className="input"
          >
            <option value="">—</option>
            {families.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code} — {f.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Tarification">
        <Field label="Prix d'achat HT (€)" required>
          <input
            name="purchasePriceHt"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={initial.purchasePriceHt ?? ""}
            required
            className="input tabular-nums"
          />
        </Field>
        <Field label="Prix de vente HT par défaut (€)" required>
          <input
            name="defaultSalePriceHt"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={initial.defaultSalePriceHt ?? ""}
            required
            className="input tabular-nums"
          />
        </Field>
        <Field label="Taux TVA (%)">
          <select
            name="vatRate"
            defaultValue={initial.vatRate ?? "20.00"}
            className="input"
          >
            {vatRates.map((v) => (
              <option key={v.rate} value={v.rate}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Documents & médias">
        <Field label="URL fiche technique" wide>
          <input
            name="ftUrl"
            type="url"
            defaultValue={initial.ftUrl ?? ""}
            className="input"
          />
        </Field>
        <Field label="URL FDS (sécurité)" wide>
          <input
            name="fdsUrl"
            type="url"
            defaultValue={initial.fdsUrl ?? ""}
            className="input"
          />
        </Field>
        <Field label="URL photo" wide>
          <input
            name="pictureUrl"
            type="url"
            defaultValue={initial.pictureUrl ?? ""}
            className="input"
          />
        </Field>
      </Section>

      <Section title="Logistique">
        <Field label="Poids (kg)">
          <input
            name="weightKg"
            type="number"
            step="0.001"
            min="0"
            defaultValue={initial.weightKg ?? ""}
            className="input tabular-nums"
          />
        </Field>
        <Field label="Volume (L)">
          <input
            name="volumeL"
            type="number"
            step="0.001"
            min="0"
            defaultValue={initial.volumeL ?? ""}
            className="input tabular-nums"
          />
        </Field>
      </Section>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active ?? true}
            className="size-4"
          />
          Produit actif
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "Enregistrement…" : mode === "create" ? "Créer le produit" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-medium text-neutral-700">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  wide,
  children,
}: {
  label: string;
  required?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs text-neutral-500">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
