// Numérotation et nomenclature de fichiers — factures clients et fournisseurs.
// Format : YYYYMMDD-NN (compteur séquentiel à 2 chiffres dans la journée).
// Choix retenu pour la conformité légale (séquentiel, sans saut, chronologique)
// tout en restant opaque sur le volume annuel : un client ne voit que la date.

import { and, eq, like } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Convertit "YYYY-MM-DD" → "YYYYMMDD".
 */
function dateKey(issueDate: string): string {
  return issueDate.replaceAll("-", "");
}

/**
 * Renvoie le prochain numéro de facture pour une date d'émission donnée.
 * Lit le max du compteur intra-jour parmi les factures déjà numérotées au
 * format `YYYYMMDD-NN`, +1.
 *
 * Si aucune facture n'existe pour cette date, renvoie `YYYYMMDD-01`.
 *
 * @param issueDate format ISO `YYYY-MM-DD`
 */
export async function nextInvoiceNumber(issueDate: string): Promise<string> {
  const prefix = dateKey(issueDate); // "YYYYMMDD"
  const rows = await db
    .select({ n: schema.invoices.invoiceNumber })
    .from(schema.invoices)
    .where(like(schema.invoices.invoiceNumber, `${prefix}-%`));
  let maxSeq = 0;
  for (const r of rows) {
    const m = r.n.match(/^\d{8}-(\d+)$/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${prefix}-${(maxSeq + 1).toString().padStart(2, "0")}`;
}

/**
 * Calcule le numéro déterministe d'une facture donnée, dans l'ordre
 * chronologique global d'émission. Utilisé par le script de renumérotation
 * one-shot (rebuild de toute la base).
 *
 * Tri primaire : `issueDate` (ASC)
 * Tri secondaire : `createdAt` (ASC) pour départager les factures du même jour
 *
 * Renvoie un Map<invoiceId, newInvoiceNumber>.
 */
export function computeChronoNumbers(
  invoices: ReadonlyArray<{
    id: string;
    issueDate: string;
    createdAt: Date;
  }>,
): Map<string, string> {
  const sorted = [...invoices].sort((a, b) => {
    if (a.issueDate !== b.issueDate) {
      return a.issueDate < b.issueDate ? -1 : 1;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const seqByDate = new Map<string, number>();
  const out = new Map<string, string>();
  for (const inv of sorted) {
    const key = dateKey(inv.issueDate);
    const next = (seqByDate.get(key) ?? 0) + 1;
    seqByDate.set(key, next);
    out.set(inv.id, `${key}-${next.toString().padStart(2, "0")}`);
  }
  return out;
}

// ============================================================================
// Nomenclature fichiers PDF
// ============================================================================

/**
 * Sanitise un nom (client ou fournisseur) pour l'usage dans un nom de fichier.
 */
export function sanitizeForFilename(s: string): string {
  return s
    .replace(/[\/\\<>:"|?*\x00-\x1f]/g, "")
    .trim()
    .slice(0, 80);
}

/**
 * Nom de fichier d'une facture client.
 * Format : YYMMDD-LCD-Facture {client}.pdf
 * Cas collision (2+ factures même jour même client) : suffixe (N).
 */
export function buildClientInvoiceFilename(
  invoiceNumber: string,
  clientName: string,
): string {
  const [yyyymmdd, nn] = invoiceNumber.split("-");
  const yymmdd = yyyymmdd.slice(2);
  const seq = Number.parseInt(nn ?? "1", 10);
  const safe = sanitizeForFilename(clientName);
  const base = `${yymmdd}-LCD-Facture ${safe}`;
  return seq <= 1 ? `${base}.pdf` : `${base} (${seq}).pdf`;
}

/**
 * Nom de fichier d'une facture fournisseur.
 * Format : YYMMDD-LCD-FacFour-{fournisseur}.pdf
 * Path complet recommandé : factures-achat/YYYY/{filename}.
 */
export function buildSupplierInvoiceFilename(
  issueDate: string, // YYYY-MM-DD
  supplierCode: string,
  uniquifier?: string, // ex le numéro de facture fournisseur, pour éviter les collisions
): string {
  const [yyyy, mm, dd] = issueDate.split("-");
  const yymmdd = `${yyyy.slice(2)}${mm}${dd}`;
  const safe = sanitizeForFilename(supplierCode);
  const base = `${yymmdd}-LCD-FacFour-${safe}`;
  return uniquifier ? `${base}-${sanitizeForFilename(uniquifier)}.pdf` : `${base}.pdf`;
}

/**
 * Path complet d'une facture fournisseur dans Vercel Blob.
 */
export function buildSupplierInvoiceBlobPath(
  issueDate: string,
  supplierCode: string,
  uniquifier?: string,
): string {
  const year = issueDate.slice(0, 4);
  const filename = buildSupplierInvoiceFilename(issueDate, supplierCode, uniquifier);
  return `factures-achat/${year}/${filename}`;
}
