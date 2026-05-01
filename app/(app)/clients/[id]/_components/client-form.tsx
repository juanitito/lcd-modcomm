"use client";

import { useState, useTransition } from "react";

type Category = { code: string; label: string };

type Contact = {
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
};

type Initial = {
  code?: string;
  name?: string | null;
  legalName?: string | null;
  siret?: string | null;
  vatNumber?: string | null;
  iban?: string | null;
  billingAddress?: string | null;
  billingCity?: string | null;
  billingZip?: string | null;
  shippingAddress?: string | null;
  shippingCity?: string | null;
  shippingZip?: string | null;
  geoZone?: string | null;
  categoryCode?: string | null;
  defaultMarginPct?: string | null;
  paymentTerms?: string | null;
  contacts?: Contact[];
  active?: boolean;
};

export function ClientForm({
  initial,
  categories,
  action,
  mode,
}: {
  initial: Initial;
  categories: Category[];
  action: (formData: FormData) => Promise<void>;
  mode: "edit" | "create";
}) {
  const [isPending, startTransition] = useTransition();
  const [contacts, setContacts] = useState<Contact[]>(
    initial.contacts && initial.contacts.length > 0 ? initial.contacts : [{}],
  );

  return (
    <form
      action={(fd) => {
        fd.set("contacts", JSON.stringify(contacts));
        startTransition(() => action(fd));
      }}
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
            className="input"
          />
        </Field>
        <Field label="Raison sociale" wide>
          <input
            name="legalName"
            defaultValue={initial.legalName ?? ""}
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
        <Field label="IBAN">
          <input
            name="iban"
            defaultValue={initial.iban ?? ""}
            maxLength={34}
            className="input font-mono"
          />
        </Field>
        <Field label="Catégorie">
          <select
            name="categoryCode"
            defaultValue={initial.categoryCode ?? ""}
            className="input"
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Adresse de facturation">
        <Field label="Adresse" wide>
          <input
            name="billingAddress"
            defaultValue={initial.billingAddress ?? ""}
            className="input"
          />
        </Field>
        <Field label="Code postal">
          <input
            name="billingZip"
            defaultValue={initial.billingZip ?? ""}
            className="input"
          />
        </Field>
        <Field label="Ville">
          <input
            name="billingCity"
            defaultValue={initial.billingCity ?? ""}
            className="input"
          />
        </Field>
      </Section>

      <Section title="Adresse de livraison">
        <Field label="Adresse" wide>
          <input
            name="shippingAddress"
            defaultValue={initial.shippingAddress ?? ""}
            className="input"
          />
        </Field>
        <Field label="Code postal">
          <input
            name="shippingZip"
            defaultValue={initial.shippingZip ?? ""}
            className="input"
          />
        </Field>
        <Field label="Ville">
          <input
            name="shippingCity"
            defaultValue={initial.shippingCity ?? ""}
            className="input"
          />
        </Field>
      </Section>

      <Section title="Commercial">
        <Field label="Zone géographique (ZG)">
          <input
            name="geoZone"
            defaultValue={initial.geoZone ?? ""}
            placeholder="ex. BONIF, AJA, PVN…"
            className="input"
          />
        </Field>
        <Field label="Marge cible (%)">
          <input
            name="defaultMarginPct"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial.defaultMarginPct ?? ""}
            className="input tabular-nums"
          />
        </Field>
        <Field label="Conditions de paiement" wide>
          <input
            name="paymentTerms"
            defaultValue={initial.paymentTerms ?? "à réception"}
            className="input"
          />
        </Field>
      </Section>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700">Contacts</h2>
          <button
            type="button"
            onClick={() => setContacts([...contacts, {}])}
            className="text-xs text-neutral-600 hover:text-neutral-900"
          >
            + ajouter
          </button>
        </div>
        <div className="grid gap-3">
          {contacts.map((c, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-md border border-neutral-200 p-3 sm:grid-cols-4"
            >
              <input
                value={c.name ?? ""}
                onChange={(e) =>
                  setContacts(
                    contacts.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Nom"
                className="input"
              />
              <input
                value={c.role ?? ""}
                onChange={(e) =>
                  setContacts(
                    contacts.map((x, j) =>
                      j === i ? { ...x, role: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Fonction"
                className="input"
              />
              <input
                value={c.phone ?? ""}
                onChange={(e) =>
                  setContacts(
                    contacts.map((x, j) =>
                      j === i ? { ...x, phone: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Téléphone"
                className="input"
              />
              <div className="flex items-center gap-2">
                <input
                  value={c.email ?? ""}
                  onChange={(e) =>
                    setContacts(
                      contacts.map((x, j) =>
                        j === i ? { ...x, email: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="Email"
                  className="input"
                />
                {contacts.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setContacts(contacts.filter((_, j) => j !== i))
                    }
                    className="text-xs text-neutral-400 hover:text-red-600"
                    aria-label="Supprimer"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active ?? true}
            className="size-4"
          />
          Client actif
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending
            ? "Enregistrement…"
            : mode === "create"
              ? "Créer le client"
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
