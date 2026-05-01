"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

function strNullable(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s || null;
}

function strToNum(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n.toString() : null;
}

const idSchema = z.string().uuid();

const contactSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

function parseContacts(raw: FormDataEntryValue | null) {
  const s = (raw ?? "").toString().trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => contactSchema.parse(c))
      .filter((c) => c.name || c.email || c.phone);
  } catch {
    return [];
  }
}

async function categoryIdFromCode(code: string | null): Promise<string | null> {
  if (!code) return null;
  const found = await db.query.clientCategories.findFirst({
    where: eq(schema.clientCategories.code, code),
  });
  if (!found) throw new Error(`Catégorie inconnue : ${code}`);
  return found.id;
}

function valuesFromForm(formData: FormData) {
  const name = (formData.get("name") ?? "").toString().trim();
  if (!name) throw new Error("Le nom est requis.");

  return {
    name,
    legalName: strNullable(formData.get("legalName")),
    siret: strNullable(formData.get("siret")),
    vatNumber: strNullable(formData.get("vatNumber")),
    iban: strNullable(formData.get("iban")),
    billingAddress: strNullable(formData.get("billingAddress")),
    billingCity: strNullable(formData.get("billingCity")),
    billingZip: strNullable(formData.get("billingZip")),
    shippingAddress: strNullable(formData.get("shippingAddress")),
    shippingCity: strNullable(formData.get("shippingCity")),
    shippingZip: strNullable(formData.get("shippingZip")),
    geoZone: strNullable(formData.get("geoZone")),
    defaultMarginPct: strToNum(formData.get("defaultMarginPct")),
    paymentTerms: strNullable(formData.get("paymentTerms")) ?? "à réception",
    contacts: parseContacts(formData.get("contacts")),
    active: formData.get("active") === "on",
  };
}

export async function updateClient(clientId: string, formData: FormData) {
  await requireAuth();
  const id = idSchema.parse(clientId);

  const categoryCode = strNullable(formData.get("categoryCode"));
  const categoryId = await categoryIdFromCode(categoryCode);

  await db
    .update(schema.clients)
    .set({
      ...valuesFromForm(formData),
      categoryId,
      updatedAt: new Date(),
    })
    .where(eq(schema.clients.id, id));

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function createClient(formData: FormData) {
  await requireAuth();

  const code = (formData.get("code") ?? "").toString().trim();
  if (!code) throw new Error("Le code est requis.");

  const existing = await db.query.clients.findFirst({
    where: eq(schema.clients.code, code),
  });
  if (existing) throw new Error(`Le code ${code} existe déjà.`);

  const categoryCode = strNullable(formData.get("categoryCode"));
  const categoryId = await categoryIdFromCode(categoryCode);

  const [created] = await db
    .insert(schema.clients)
    .values({
      code,
      ...valuesFromForm(formData),
      categoryId,
    })
    .returning({ id: schema.clients.id });

  revalidatePath("/clients");
  redirect(`/clients/${created.id}`);
}

const upsertPriceSchema = z.object({
  clientId: z.string().uuid(),
  productId: z.string().uuid(),
  salePriceHt: z.string().refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0),
  marginPct: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function setClientPrice(input: {
  clientId: string;
  productId: string;
  salePriceHt: string;
  marginPct?: string | null;
  notes?: string | null;
}) {
  await requireAuth();
  const data = upsertPriceSchema.parse(input);

  await db
    .insert(schema.clientProductPrices)
    .values({
      clientId: data.clientId,
      productId: data.productId,
      salePriceHt: data.salePriceHt,
      marginPct: data.marginPct ?? null,
      notes: data.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.clientProductPrices.clientId,
        schema.clientProductPrices.productId,
      ],
      set: {
        salePriceHt: data.salePriceHt,
        marginPct: data.marginPct ?? null,
        notes: data.notes ?? null,
        updatedAt: new Date(),
      },
    });

  revalidatePath(`/clients/${data.clientId}`);
}

export async function removeClientPrice(input: {
  clientId: string;
  productId: string;
}) {
  await requireAuth();
  const clientId = idSchema.parse(input.clientId);
  const productId = idSchema.parse(input.productId);

  await db
    .delete(schema.clientProductPrices)
    .where(
      and(
        eq(schema.clientProductPrices.clientId, clientId),
        eq(schema.clientProductPrices.productId, productId),
      ),
    );

  revalidatePath(`/clients/${clientId}`);
}
