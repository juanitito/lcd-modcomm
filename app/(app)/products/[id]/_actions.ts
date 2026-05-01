"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

function strToNum(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n.toString() : null;
}

function strNullable(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s || null;
}

const idSchema = z.string().uuid();

export async function updateProduct(productId: string, formData: FormData) {
  await requireAuth();
  const id = idSchema.parse(productId);

  const designation = (formData.get("designation") ?? "").toString().trim();
  if (!designation) throw new Error("La désignation est requise.");

  const purchase = strToNum(formData.get("purchasePriceHt"));
  const sale = strToNum(formData.get("defaultSalePriceHt"));
  if (!purchase || !sale) throw new Error("Prix d'achat et prix de vente requis.");

  const vat = strToNum(formData.get("vatRate")) ?? "20.00";
  const supplierCode = strNullable(formData.get("supplierCode"));
  const familyCode = strNullable(formData.get("familyCode"));

  let supplierId: string | null = null;
  if (supplierCode) {
    const found = await db.query.suppliers.findFirst({
      where: eq(schema.suppliers.code, supplierCode),
    });
    if (!found) throw new Error(`Fournisseur inconnu : ${supplierCode}`);
    supplierId = found.id;
  }

  let familyId: string | null = null;
  if (familyCode) {
    const found = await db.query.productFamilies.findFirst({
      where: eq(schema.productFamilies.code, familyCode),
    });
    if (!found) throw new Error(`Famille inconnue : ${familyCode}`);
    familyId = found.id;
  }

  await db
    .update(schema.products)
    .set({
      designation,
      conditionnement: strNullable(formData.get("conditionnement")),
      moq: strNullable(formData.get("moq")),
      purchasePriceHt: purchase,
      defaultSalePriceHt: sale,
      vatRate: vat,
      supplierId,
      familyId,
      ftUrl: strNullable(formData.get("ftUrl")),
      fdsUrl: strNullable(formData.get("fdsUrl")),
      pictureUrl: strNullable(formData.get("pictureUrl")),
      weightKg: strToNum(formData.get("weightKg")),
      volumeL: strToNum(formData.get("volumeL")),
      active: formData.get("active") === "on",
      updatedAt: new Date(),
    })
    .where(eq(schema.products.id, id));

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}

export async function createProduct(formData: FormData) {
  await requireAuth();

  const code = (formData.get("code") ?? "").toString().trim();
  if (!code) throw new Error("Le code est requis.");

  const designation = (formData.get("designation") ?? "").toString().trim();
  if (!designation) throw new Error("La désignation est requise.");

  const purchase = strToNum(formData.get("purchasePriceHt"));
  const sale = strToNum(formData.get("defaultSalePriceHt"));
  if (!purchase || !sale) throw new Error("Prix d'achat et prix de vente requis.");

  const vat = strToNum(formData.get("vatRate")) ?? "20.00";
  const supplierCode = strNullable(formData.get("supplierCode"));
  const familyCode = strNullable(formData.get("familyCode"));

  let supplierId: string | null = null;
  if (supplierCode) {
    const found = await db.query.suppliers.findFirst({
      where: eq(schema.suppliers.code, supplierCode),
    });
    if (!found) throw new Error(`Fournisseur inconnu : ${supplierCode}`);
    supplierId = found.id;
  }

  let familyId: string | null = null;
  if (familyCode) {
    const found = await db.query.productFamilies.findFirst({
      where: eq(schema.productFamilies.code, familyCode),
    });
    if (!found) throw new Error(`Famille inconnue : ${familyCode}`);
    familyId = found.id;
  }

  const existing = await db.query.products.findFirst({
    where: eq(schema.products.code, code),
  });
  if (existing) throw new Error(`Le code ${code} existe déjà.`);

  const [created] = await db
    .insert(schema.products)
    .values({
      code,
      designation,
      conditionnement: strNullable(formData.get("conditionnement")),
      moq: strNullable(formData.get("moq")),
      purchasePriceHt: purchase,
      defaultSalePriceHt: sale,
      vatRate: vat,
      supplierId,
      familyId,
      ftUrl: strNullable(formData.get("ftUrl")),
      fdsUrl: strNullable(formData.get("fdsUrl")),
      pictureUrl: strNullable(formData.get("pictureUrl")),
      weightKg: strToNum(formData.get("weightKg")),
      volumeL: strToNum(formData.get("volumeL")),
      active: formData.get("active") === "on",
    })
    .returning({ id: schema.products.id });

  revalidatePath("/products");
  redirect(`/products/${created.id}`);
}
