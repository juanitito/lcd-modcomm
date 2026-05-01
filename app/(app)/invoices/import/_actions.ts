"use server";

import { put } from "@vercel/blob";
import { eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { extractInvoice } from "@/lib/invoice-extract";

type Direction = "client" | "supplier";

type Counterparty = {
  clientId: string | null;
  supplierId: string | null;
};

async function findCounterparty(
  direction: Direction,
  extracted: {
    clientGuess?: { name?: string | null; siret?: string | null } | null;
  },
): Promise<Counterparty> {
  const siret = extracted.clientGuess?.siret?.replace(/\D/g, "");
  const name = extracted.clientGuess?.name?.trim();

  if (direction === "client") {
    if (siret && siret.length === 14) {
      const bySiret = await db.query.clients.findFirst({
        where: eq(schema.clients.siret, siret),
      });
      if (bySiret) return { clientId: bySiret.id, supplierId: null };
    }
    if (name) {
      const byName = await db.query.clients.findFirst({
        where: ilike(schema.clients.name, `%${name.slice(0, 20)}%`),
      });
      if (byName) return { clientId: byName.id, supplierId: null };
    }
    return { clientId: null, supplierId: null };
  }

  // direction === "supplier"
  if (siret && siret.length === 14) {
    const bySiret = await db.query.suppliers.findFirst({
      where: eq(schema.suppliers.siret, siret),
    });
    if (bySiret) return { clientId: null, supplierId: bySiret.id };
  }
  if (name) {
    const byName = await db.query.suppliers.findFirst({
      where: ilike(schema.suppliers.name, `%${name.slice(0, 20)}%`),
    });
    if (byName) return { clientId: null, supplierId: byName.id };
  }
  return { clientId: null, supplierId: null };
}

const directionSchema = z.enum(["client", "supplier"]);

export async function uploadInvoicePdfs(formData: FormData) {
  await requireAuth();

  const direction = directionSchema.parse(
    (formData.get("direction") ?? "client").toString(),
  );

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
        direction,
        status: "pending",
      })
      .returning({ id: schema.invoiceImports.id });

    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const extracted = await extractInvoice(buf, direction);
      const match = await findCounterparty(direction, extracted);

      await db
        .update(schema.invoiceImports)
        .set({
          extracted,
          matchedClientId: match.clientId,
          matchedSupplierId: match.supplierId,
          status:
            match.clientId || match.supplierId ? "extracted" : "needs_review",
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
  if (!imp) {
    revalidatePath("/invoices/import");
    return;
  }
  if (imp.status === "materialized") {
    revalidatePath("/invoices/import");
    return;
  }

  try {
    const res = await fetch(imp.pdfBlobUrl);
    if (!res.ok) throw new Error(`Lecture du PDF (Blob) : HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const extracted = await extractInvoice(buf, imp.direction);
    const match = await findCounterparty(imp.direction, extracted);

    await db
      .update(schema.invoiceImports)
      .set({
        extracted,
        matchedClientId: match.clientId,
        matchedSupplierId: match.supplierId,
        errorMessage: null,
        status:
          match.clientId || match.supplierId ? "extracted" : "needs_review",
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
  }

  revalidatePath("/invoices/import");
}

const setClientSchema = z.object({
  importId: z.string().uuid(),
  clientId: z.string().uuid(),
});

const setSupplierSchema = z.object({
  importId: z.string().uuid(),
  supplierId: z.string().uuid(),
});

export async function setImportClient(input: {
  importId: string;
  clientId: string;
}) {
  await requireAuth();
  const data = setClientSchema.parse(input);

  await db
    .update(schema.invoiceImports)
    .set({
      matchedClientId: data.clientId,
      matchedSupplierId: null,
      status: "extracted",
      updatedAt: new Date(),
    })
    .where(eq(schema.invoiceImports.id, data.importId));

  revalidatePath("/invoices/import");
}

export async function setImportSupplier(input: {
  importId: string;
  supplierId: string;
}) {
  await requireAuth();
  const data = setSupplierSchema.parse(input);

  await db
    .update(schema.invoiceImports)
    .set({
      matchedSupplierId: data.supplierId,
      matchedClientId: null,
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
  if (!imp.extracted) throw new Error("Pas de données extraites.");
  if (imp.status === "materialized") throw new Error("Déjà matérialisé.");

  const ex = imp.extracted;
  if (!ex.legacyNumber) throw new Error("Numéro de facture héritage manquant.");
  if (!ex.issueDate) throw new Error("Date d'émission manquante.");
  if (!ex.totals?.totalHt || !ex.totals?.totalVat || !ex.totals?.totalTtc) {
    throw new Error("Totaux incomplets.");
  }

  if (imp.direction === "client") {
    if (!imp.matchedClientId) throw new Error("Aucun client matché.");
    await materializeAsClientInvoice(imp, ex, imp.matchedClientId);
  } else {
    if (!imp.matchedSupplierId) throw new Error("Aucun fournisseur matché.");
    await materializeAsSupplierInvoice(imp, ex, imp.matchedSupplierId);
  }

  revalidatePath("/invoices/import");
  revalidatePath("/invoices");
}

async function materializeAsClientInvoice(
  imp: typeof schema.invoiceImports.$inferSelect,
  ex: NonNullable<typeof schema.invoiceImports.$inferSelect.extracted>,
  clientId: string,
) {
  const client = await db.query.clients.findFirst({
    where: eq(schema.clients.id, clientId),
  });
  if (!client) throw new Error("Client introuvable.");

  const invoiceNumber = `LEGACY-${ex.legacyNumber}`;
  const existing = await db.query.invoices.findFirst({
    where: eq(schema.invoices.invoiceNumber, invoiceNumber),
  });
  if (existing) throw new Error(`Facture ${invoiceNumber} déjà existante.`);

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
      issueDate: ex.issueDate!,
      dueDate: ex.dueDate ?? null,
      paymentTerms: client.paymentTerms,
      totalHt: String(ex.totals!.totalHt),
      totalVat: String(ex.totals!.totalVat),
      totalTtc: String(ex.totals!.totalTtc),
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
    .where(eq(schema.invoiceImports.id, imp.id));
}

async function materializeAsSupplierInvoice(
  imp: typeof schema.invoiceImports.$inferSelect,
  ex: NonNullable<typeof schema.invoiceImports.$inferSelect.extracted>,
  supplierId: string,
) {
  const supplier = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.id, supplierId),
  });
  if (!supplier) throw new Error("Fournisseur introuvable.");

  // Pour les fournisseurs : on stocke le numéro tel quel (référence externe).
  // Unique key (supplier_id, supplier_invoice_number) garantit qu'on
  // n'importera pas la même facture deux fois.
  const existing = await db.query.supplierInvoices.findFirst({
    where: (si, { and: a, eq: e }) =>
      a(
        e(si.supplierId, supplier.id),
        e(si.supplierInvoiceNumber, ex.legacyNumber!),
      ),
  });
  if (existing)
    throw new Error(
      `Facture ${ex.legacyNumber} déjà existante pour ${supplier.name}.`,
    );

  const lines = ex.lines ?? [];
  const breakdown = ex.vatBreakdown ?? [];

  const [created] = await db
    .insert(schema.supplierInvoices)
    .values({
      supplierInvoiceNumber: ex.legacyNumber!,
      type: "invoice",
      supplierId: supplier.id,
      supplierSnapshot: {
        name: supplier.name,
        legalName: supplier.legalName ?? undefined,
        siret: supplier.siret ?? undefined,
        vatNumber: supplier.vatNumber ?? undefined,
      },
      issueDate: ex.issueDate!,
      dueDate: ex.dueDate ?? null,
      totalHt: String(ex.totals!.totalHt),
      totalVat: String(ex.totals!.totalVat),
      totalTtc: String(ex.totals!.totalTtc),
      vatBreakdown: breakdown.map((b) => ({
        rate: b.rate.toFixed(2),
        base: b.base.toFixed(2),
        vat: b.vat.toFixed(2),
      })),
      pdfBlobUrl: imp.pdfBlobUrl,
      pdfBlobPath: imp.pdfBlobPath,
      status: "issued",
    })
    .returning({ id: schema.supplierInvoices.id });

  if (lines.length > 0) {
    await db.insert(schema.supplierInvoiceLines).values(
      lines.map((l, i) => ({
        supplierInvoiceId: created.id,
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
      materializedSupplierInvoiceId: created.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.invoiceImports.id, imp.id));
}

export async function deleteImport(importId: string) {
  await requireAuth();
  const id = idSchema.parse(importId);
  await db.delete(schema.invoiceImports).where(eq(schema.invoiceImports.id, id));
  revalidatePath("/invoices/import");
}
