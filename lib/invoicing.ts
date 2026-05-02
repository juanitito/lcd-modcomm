// Numérotation des factures clients.
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
