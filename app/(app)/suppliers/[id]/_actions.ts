"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

function strNullable(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s || null;
}

const idSchema = z.string().uuid();

function valuesFromForm(formData: FormData) {
  const name = (formData.get("name") ?? "").toString().trim();
  if (!name) throw new Error("Le nom est requis.");

  return {
    name,
    legalName: strNullable(formData.get("legalName")),
    siret: strNullable(formData.get("siret")),
    vatNumber: strNullable(formData.get("vatNumber")),
    contactEmail: strNullable(formData.get("contactEmail")),
    contactPhone: strNullable(formData.get("contactPhone")),
    customerAccountNumber: strNullable(formData.get("customerAccountNumber")),
    active: formData.get("active") === "on",
  };
}

export async function updateSupplier(supplierId: string, formData: FormData) {
  await requireAuth();
  const id = idSchema.parse(supplierId);

  await db
    .update(schema.suppliers)
    .set(valuesFromForm(formData))
    .where(eq(schema.suppliers.id, id));

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${id}`);
}

export async function createSupplier(formData: FormData) {
  await requireAuth();

  const code = (formData.get("code") ?? "").toString().trim();
  if (!code) throw new Error("Le code est requis.");

  const existing = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.code, code),
  });
  if (existing) throw new Error(`Le code ${code} existe déjà.`);

  const [created] = await db
    .insert(schema.suppliers)
    .values({
      code,
      ...valuesFromForm(formData),
    })
    .returning({ id: schema.suppliers.id });

  revalidatePath("/suppliers");
  redirect(`/suppliers/${created.id}`);
}
