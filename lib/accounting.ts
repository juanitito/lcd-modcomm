// Helpers compta : registre des classifications non-facture, seed PCG minimal,
// période courante, numérotation séquentielle.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

type JournalCode = (typeof schema.journalCode.enumValues)[number];

// Comptes PCG utilisés par les classifications. La table `chart_of_accounts`
// est seedée à la demande, dérivée des comptes référencés ci-dessous.
const PCG_ACCOUNTS: Record<
  string,
  { label: string; parentCode: string | null; classCode: string; nature: string }
> = {
  "512": { label: "Banque", parentCode: "51", classCode: "5", nature: "actif" },
  "455": {
    label: "Associés — comptes courants",
    parentCode: "45",
    classCode: "4",
    nature: "tiers",
  },
  "6061": {
    label: "Fournitures non stockables (eau, énergie, carburants)",
    parentCode: "606",
    classCode: "6",
    nature: "charge",
  },
};

// Registre des classifications non-facture appliquables à une transaction Qonto.
// Pour ajouter un cas : étendre ce registre + référencer le compte dans
// PCG_ACCOUNTS si nouveau. Aucune autre modif requise.
//
// `side: "credit"` = crédit en banque (montant > 0), `side: "debit"` = débit.
// `debit/credit` indiquent les comptes débité/crédité dans l'écriture créée.
export const CLASSIFICATION_KINDS = {
  owner_advance: {
    label: "Avance compte courant associé",
    shortLabel: "Avance assoc.",
    side: "credit",
    debit: "512",
    credit: "455",
  },
  fuel_no_receipt: {
    label: "Carburant sans ticket",
    shortLabel: "Carburant ss ticket",
    side: "debit",
    debit: "6061",
    credit: "512",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    shortLabel: string;
    side: "credit" | "debit";
    debit: string;
    credit: string;
  }
>;

export type ClassificationKind = keyof typeof CLASSIFICATION_KINDS;

export const CLASSIFICATION_KINDS_BY_SIDE: Record<
  "credit" | "debit",
  Array<{ key: ClassificationKind; label: string; shortLabel: string }>
> = {
  credit: [],
  debit: [],
};
for (const [key, def] of Object.entries(CLASSIFICATION_KINDS)) {
  CLASSIFICATION_KINDS_BY_SIDE[def.side].push({
    key: key as ClassificationKind,
    label: def.label,
    shortLabel: def.shortLabel,
  });
}

export async function ensurePcgAccountsExist() {
  for (const [code, a] of Object.entries(PCG_ACCOUNTS)) {
    await db
      .insert(schema.chartOfAccounts)
      .values({ code, ...a })
      .onConflictDoNothing({ target: schema.chartOfAccounts.code });
  }
}

export async function getOrCreatePeriodForDate(
  date: Date,
): Promise<typeof schema.accountingPeriods.$inferSelect> {
  const iso = date.toISOString().slice(0, 10);
  const found = await db.query.accountingPeriods.findFirst({
    where: and(
      lte(schema.accountingPeriods.startDate, iso),
      gte(schema.accountingPeriods.endDate, iso),
    ),
  });
  if (found) return found;

  const year = date.getUTCFullYear();
  const [created] = await db
    .insert(schema.accountingPeriods)
    .values({
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      label: `Exercice ${year}`,
      status: "open",
    })
    .returning();
  return created;
}

export async function nextEntryNumber(
  date: Date,
  journal: JournalCode,
): Promise<string> {
  const year = date.getUTCFullYear();
  const prefix = `${year}-${journal}-`;
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.journalEntries)
    .where(sql`${schema.journalEntries.entryNumber} LIKE ${prefix + "%"}`);
  const next = (c ?? 0) + 1;
  return `${prefix}${next.toString().padStart(4, "0")}`;
}

export async function deleteJournalEntry(entryId: string) {
  // journalLines ont onDelete:cascade → suppression atomique côté DB.
  await db
    .delete(schema.journalEntries)
    .where(eq(schema.journalEntries.id, entryId));
}
