"use client";

import { useTransition } from "react";

type Initial = {
  code?: string;
  name?: string | null;
  legalName?: string | null;
  siret?: string | null;
  vatNumber?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  customerAccountNumber?: string | null;
  active?: boolean;
};

export function SupplierForm({
  initial,
  action,
  mode,
}: {
  initial: Initial;
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
        <Field label="Nom commercial" required wide>
          <input
            name="name"
            defaultValue={initial.name ?? ""}
            required
            placeholder="ex. MR Net"
            className="input"
          />
        </Field>
        <Field label="Raison sociale" wide>
          <input
            name="legalName"
            defaultValue={initial.legalName ?? ""}
            placeholder="ex. MR NET SAS"
            className="input"
          />
        </Field>
        <Field label="SIRET">
          <input
            name="siret"
            defaultValue={initial.siret ?? ""}
            maxLength={14}
            className="input font-mono"
          />
        </Field>
        <Field label="N° TVA intracom">
          <input
            name="vatNumber"
            defaultValue={initial.vatNumber ?? ""}
            className="input font-mono"
          />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Email">
          <input
            name="contactEmail"
            type="email"
            defaultValue={initial.contactEmail ?? ""}
            className="input"
          />
        </Field>
        <Field label="Téléphone">
          <input
            name="contactPhone"
            defaultValue={initial.contactPhone ?? ""}
            className="input"
          />
        </Field>
        <Field label="N° de compte client (chez eux)" wide>
          <input
            name="customerAccountNumber"
            defaultValue={initial.customerAccountNumber ?? ""}
            placeholder="ex. notre n° de compte chez ce fournisseur"
            className="input"
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
          Fournisseur actif
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending
            ? "Enregistrement…"
            : mode === "create"
              ? "Créer le fournisseur"
              : "Enregistrer"}
        </button>
      </div>
    </form>
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
