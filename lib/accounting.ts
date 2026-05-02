// Helpers compta server-only : seed PCG, période courante, numérotation.
// Le registre des kinds + comptes PCG vit dans `accounting-kinds.ts` (importable
// depuis le client).

import { and, eq, gte, like, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PCG_ACCOUNTS } from "@/lib/accounting-kinds";

export {
  CLASSIFICATION_KINDS,
  CLASSIFICATION_KINDS_BY_SIDE,
  type ClassificationKind,
} from "@/lib/accounting-kinds";

type JournalCode = (typeof schema.journalCode.enumValues)[number];

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
  // On prend le max du suffixe numérique (et pas count+1) pour éviter les
  // collisions quand des écritures ont été supprimées dans la séquence
  // (clearMatch laisse des trous, qu'on garde volontairement pour l'audit).
  // MAX calculé côté JS plutôt qu'en SQL — quelques centaines d'écritures
  // max par an, coût négligeable, et ça évite les pièges de templating.
  const rows = await db
    .select({ n: schema.journalEntries.entryNumber })
    .from(schema.journalEntries)
    .where(like(schema.journalEntries.entryNumber, prefix + "%"));
  let maxSuffix = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.n.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxSuffix) maxSuffix = n;
  }
  const next = maxSuffix + 1;
  return `${prefix}${next.toString().padStart(4, "0")}`;
}

export async function deleteJournalEntry(entryId: string) {
  // journalLines ont onDelete:cascade → suppression atomique côté DB.
  await db
    .delete(schema.journalEntries)
    .where(eq(schema.journalEntries.id, entryId));
}
