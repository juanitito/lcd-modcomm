"use server";

import { put } from "@vercel/blob";
import { eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { extractInvoice } from "@/lib/invoice-extract";

async function findClientByExtraction(extracted: {
  clientGuess?: { name?: string | null; siret?: string | null };
}): Promise<string | null> {
  const siret = extracted.clientGuess?.siret?.replace(/\D/g, "");
  if (siret && siret.length === 14) {
    const bySiret = await db.query.clients.findFirst({
      where: eq(schema.clients.siret, siret),
    });
    if (bySiret) return bySiret.id;
  }
  const name = extracted.clientGuess?.name?.trim();
  if (name) {
    const byName = await db.query.clients.findFirst({
      where: ilike(schema.clients.name, `%${name.slice(0, 20)}%`),
    });
    if (byName) return byName.id;
  }
  return null;
}

export async function uploadInvoicePdfs(formData: FormData) {
  await requireAuth();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new Error("Aucun fichier sélectionné.");

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".pdf")) continue;

    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const blobPath = `invoices/imports/${Date.now()}-${safeName}`;
    const blob = await put(blobPath, file, {
      access: "public",
      addRandomSuffix: false,
    });

    const [imp] = await db
      .insert(schema.invoiceImports)
      .values({
        pdfBlobUrl: blob.url,
        pdfBlobPath: blob.pathname,
        sourceFilename: file.name,
        status: "pending",
      })
      .returning({ id: schema.invoiceImports.id });

    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const extracted = await extractInvoice(buf);
      const matchedClientId = await findClientByExtraction(extracted);

      await db
        .update(schema.invoiceImports)
        .set({
          extracted,
          matchedClientId,
          status: matchedClientId ? "extracted" : "needs_review",
          updatedAt: new Date(),
        })
        .where(eq(schema.invoiceImports.id, imp.id));
    } catch (err) {
      await db
        .update(schema.invoiceImports)
        .set({
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(schema.invoiceImports.id, imp.id));
    }
  }

  revalidatePath("/invoices/import");
}

export async function retryExtraction(importId: string) {
  await requireAuth();
  const id = z.string().uuid().parse(importId);

  const imp = await db.query.invoiceImports.findFirst({
    where: eq(schema.invoiceImports.id, id),
  });
  if (!imp) throw new Error("Import introuvable.");
  if (imp.status === "materialized") throw new Error("Déjà matérialisé.");

  try {
    const res = await fetch(imp.pdfBlobUrl);
    if (!res.ok) throw new Error(`Lecture du PDF (Blob) : HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const extracted = await extractInvoice(buf);
    const matchedClientId = await findClientByExtraction(extracted);

    await db
      .update(schema.invoiceImports)
      .set({
        extracted,
        matchedClientId,
        errorMessage: null,
        status: matchedClientId ? "extracted" : "needs_review",
        updatedAt: new Date(),
      })
      .where(eq(schema.invoiceImports.id, id));
  } catch (err) {
    await db
      .update(schema.invoiceImports)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(schema.invoiceImports.id, id));
    throw err;
  }

  revalidatePath("/invoices/import");
}

const matchSchema = z.object({
  importId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export async function setImportClient(input: { importId: string; clientId: string }) {
  await requireAuth();
  const data = matchSchema.parse(input);

  await db
    .update(schema.invoiceImports)
    .set({
      matchedClientId: data.clientId,
      status: "extracted",
      updatedAt: new Date(),
    })
    .where(eq(schema.invoiceImports.id, data.importId));

  revalidatePath("/invoices/import");
}

const idSchema = z.string().uuid();

export async function materializeImport(importId: string) {
  await requireAuth();
  const id = idSchema.parse(importId);

  const imp = await db.query.invoiceImports.findFirst({
    where: eq(schema.invoiceImports.id, id),
  });
  if (!imp) throw new Error("Import introuvable.");
  if (!imp.matchedClientId) throw new Error("Aucun client matché.");
  if (!imp.extracted) throw new Error("Pas de données extraites.");
  if (imp.status === "materialized") throw new Error("Déjà matérialisé.");

  const ex = imp.extracted;
  if (!ex.legacyNumber) throw new Error("Numéro de facture héritage manquant.");
  if (!ex.issueDate) throw new Error("Date d'émission manquante.");
  if (!ex.totals?.totalHt || !ex.totals?.totalVat || !ex.totals?.totalTtc) {
    throw new Error("Totaux incomplets.");
  }

  const client = await db.query.clients.findFirst({
    where: eq(schema.clients.id, imp.matchedClientId),
  });
  if (!client) throw new Error("Client introuvable.");

  // Imports = pas dans la séquence officielle. Préfixe LEGACY-.
  const invoiceNumber = `LEGACY-${ex.legacyNumber}`;

  const existing = await db.query.invoices.findFirst({
    where: eq(schema.invoices.invoiceNumber, invoiceNumber),
  });
  if (existing) {
    throw new Error(`Facture ${invoiceNumber} déjà existante.`);
  }

  const lines = ex.lines ?? [];
  const breakdown = ex.vatBreakdown ?? [];

  const [created] = await db
    .insert(schema.invoices)
    .values({
      invoiceNumber,
      legacyNumber: ex.legacyNumber,
      type: "invoice",
      clientId: client.id,
      clientSnapshot: {
        name: client.name,
        legalName: client.legalName ?? undefined,
        siret: client.siret ?? undefined,
        vatNumber: client.vatNumber ?? undefined,
        billingAddress: client.billingAddress ?? undefined,
        billingCity: client.billingCity ?? undefined,
        billingZip: client.billingZip ?? undefined,
        shippingAddress: client.shippingAddress ?? undefined,
        shippingCity: client.shippingCity ?? undefined,
        shippingZip: client.shippingZip ?? undefined,
      },
      issueDate: ex.issueDate,
      dueDate: ex.dueDate ?? null,
      paymentTerms: client.paymentTerms,
      totalHt: String(ex.totals.totalHt),
      totalVat: String(ex.totals.totalVat),
      totalTtc: String(ex.totals.totalTtc),
      vatBreakdown: breakdown.map((b) => ({
        rate: b.rate.toFixed(2),
        base: b.base.toFixed(2),
        vat: b.vat.toFixed(2),
      })),
      pdfBlobUrl: imp.pdfBlobUrl,
      pdfBlobPath: imp.pdfBlobPath,
      status: "issued",
    })
    .returning({ id: schema.invoices.id });

  if (lines.length > 0) {
    await db.insert(schema.invoiceLines).values(
      lines.map((l, i) => ({
        invoiceId: created.id,
        code: "",
        designation: l.designation,
        qty: String(l.qty),
        unitPriceHt: String(l.unitPriceHt),
        vatRate: l.vatRate.toFixed(2),
        lineTotalHt:
          l.lineTotalHt != null
            ? String(l.lineTotalHt)
            : (l.qty * l.unitPriceHt).toFixed(2),
        position: i,
      })),
    );
  }

  await db
    .update(schema.invoiceImports)
    .set({
      status: "materialized",
      materializedInvoiceId: created.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.invoiceImports.id, id));

  revalidatePath("/invoices/import");
  revalidatePath("/invoices");
}

export async function deleteImport(importId: string) {
  await requireAuth();
  const id = idSchema.parse(importId);
  await db.delete(schema.invoiceImports).where(eq(schema.invoiceImports.id, id));
  revalidatePath("/invoices/import");
}
