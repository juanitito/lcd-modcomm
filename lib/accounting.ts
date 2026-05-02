// Helpers compta : seed PCG minimal, période courante, numérotation séquentielle.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

type JournalCode = (typeof schema.journalCode.enumValues)[number];

// Comptes PCG utilisés par les classifications non-facture.
// On garde la liste minimale : on ajoute uniquement les comptes touchés par les
// flux qu'on sait classer aujourd'hui.
const PCG_ACCOUNTS: ReadonlyArray<{
  code: string;
  label: string;
  parentCode: string | null;
  classCode: string;
  nature: string;
}> = [
  // Trésorerie
  { code: "512", label: "Banque", parentCode: "51", classCode: "5", nature: "actif" },
  // Tiers — comptes courants d'associés
  { code: "455", label: "Associés — comptes courants", parentCode: "45", classCode: "4", nature: "tiers" },
];

export async function ensurePcgAccountsExist() {
  for (const a of PCG_ACCOUNTS) {
    await db
      .insert(schema.chartOfAccounts)
      .values(a)
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
