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
      "Identité du client telle qu'elle apparaît sur la facture. Tous les champs peuvent être null.",
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
Les lignes doivent reproduire l'ordre du document.`;

export async function extractInvoice(
  pdfBuffer: Buffer | Uint8Array,
): Promise<InvoiceExtraction> {
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
            text: "Voici une facture. Extrais-en les données structurées.",
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
