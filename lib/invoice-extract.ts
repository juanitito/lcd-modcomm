// Extraction structurée d'une facture PDF via Vercel AI Gateway.
// Le LLM lit le PDF directement (input multimodal) et renvoie un objet
// validé par le schéma Zod ci-dessous.

import { generateObject } from "ai";
import { z } from "zod";

export const invoiceExtractionSchema = z.object({
  legacyNumber: z
    .string()
    .nullable()
    .describe(
      "Numéro de facture imprimé sur le PDF (ex 26050001). null si introuvable.",
    ),
  issueDate: z
    .string()
    .nullable()
    .describe("Date d'émission au format YYYY-MM-DD. null si introuvable."),
  dueDate: z
    .string()
    .nullable()
    .describe("Date d'échéance au format YYYY-MM-DD. null si non précisée."),
  clientGuess: z
    .object({
      name: z.string().nullable(),
      siret: z.string().nullable(),
      address: z.string().nullable(),
    })
    .describe(
      "Identité de la contrepartie telle qu'elle apparaît sur la facture. Pour une facture émise (côté client) : le client/destinataire. Pour une facture reçue (côté fournisseur) : l'émetteur. Tous les champs peuvent être null.",
    ),
  lines: z
    .array(
      z.object({
        designation: z.string(),
        qty: z.number(),
        unitPriceHt: z.number(),
        vatRate: z.number().describe("Taux TVA en pourcentage (ex 20, 5.5)"),
        lineTotalHt: z.number().nullable(),
      }),
    )
    .describe("Lignes de la facture, dans l'ordre du document."),
  totals: z.object({
    totalHt: z.number(),
    totalVat: z.number(),
    totalTtc: z.number(),
  }),
  vatBreakdown: z
    .array(
      z.object({
        rate: z.number().describe("Taux TVA en pourcentage"),
        base: z.number().describe("Base HT pour ce taux"),
        vat: z.number().describe("Montant TVA pour ce taux"),
      }),
    )
    .describe("Ventilation TVA par taux. Vide si la facture est mono-taux."),
});

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;

const SYSTEM = `Tu es un assistant qui extrait des données structurées de factures françaises au format PDF.
Sois rigoureux : si une information n'est pas explicitement présente, retourne null plutôt que de l'inventer.
Les montants sont en euros, les taux TVA en pourcentage (ex: 20, 10, 5.5, 2.1, 0.9).
Les dates au format ISO YYYY-MM-DD.
Les lignes doivent reproduire l'ordre du document.
Le champ clientGuess représente la contrepartie sur le document (= la partie qui n'est pas le contexte d'analyse).`;

export type ExtractionDirection = "client" | "supplier";

export async function extractInvoice(
  pdfBuffer: Buffer | Uint8Array,
  direction: ExtractionDirection = "client",
): Promise<InvoiceExtraction> {
  const counterpartyHint =
    direction === "client"
      ? "Cette facture a été ÉMISE par notre entreprise (Lascia Corre Distribution). Extrais clientGuess = identité du DESTINATAIRE/CLIENT (qui doit nous payer)."
      : "Cette facture nous a été ENVOYÉE par un fournisseur. Extrais clientGuess = identité de l'ÉMETTEUR/FOURNISSEUR (qu'on doit payer). N'extrais PAS notre propre identité (Lascia Corre Distribution).";

  const { object } = await generateObject({
    model: "anthropic/claude-sonnet-4-6",
    schema: invoiceExtractionSchema,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${counterpartyHint}\n\nVoici la facture. Extrais-en les données structurées.`,
          },
          {
            type: "file",
            data: pdfBuffer,
            mediaType: "application/pdf",
          },
        ],
      },
    ],
  });
  return object;
}
