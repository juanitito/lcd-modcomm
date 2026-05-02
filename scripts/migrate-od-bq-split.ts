// Migration : reformule les écritures BQ existantes contenant des comptes
// classe 6 (charges) ou 7 (produits) en pattern OD constatation + BQ règlement
// (transit via 467). Idempotent.
//
// Cas couverts :
// - Classifications kind avec compte 6/7 : bank_referral_premium (7063),
//   bank_fee (627), supplier_penalty (6788), fuel_no_receipt (6061)
// - Splits avec un line dont accountCode est classe 6/7
//
// Cas exclus (pas de migration) :
// - Écritures BQ pures : tiers (411-/401-) + 512 + 455 + 467
// - Écritures VE/AC d'émission de facture (déjà bien jouées)
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db, schema } = await import("../lib/db");
  const { eq, and, isNull } = await import("drizzle-orm");
  const { isBqAccount, nextEntryNumber } = await import("../lib/accounting");

  // Trouver toutes les entrées BQ avec au moins une ligne classe 6 ou 7
  const candidates = await db
    .select({
      entryId: schema.journalEntries.id,
      entryNumber: schema.journalEntries.entryNumber,
      date: schema.journalEntries.date,
      label: schema.journalEntries.label,
      periodId: schema.journalEntries.periodId,
      parentEntryId: schema.journalEntries.parentEntryId,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.journal, "BQ"),
        isNull(schema.journalEntries.parentEntryId),
      ),
    );

  console.log(`${candidates.length} entrées BQ à examiner.\n`);

  let migrated = 0;
  let skipped = 0;
  for (const entry of candidates) {
    const lines = await db
      .select()
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, entry.entryId));

    // Sépare lignes 512 vs lignes "non-bank account" (classes 6/7)
    const odCandidates = lines.filter((l) => !isBqAccount(l.accountCode));
    if (odCandidates.length === 0) {
      skipped++;
      continue;
    }

    // Direction de la tx : si la ligne 512 est en débit, c'est un crédit (income/refund),
    // sinon débit (charge/payment). On regarde la ligne 512.
    const ligne512 = lines.find((l) => l.accountCode === "512");
    if (!ligne512) {
      console.log(`  ⚠ ${entry.entryNumber} : pas de ligne 512, skip`);
      skipped++;
      continue;
    }
    const direction: "credit" | "debit" =
      Number(ligne512.debit) > 0 ? "credit" : "debit";

    // Total des montants OD (somme des charges/produits à constater)
    const odTotal = odCandidates.reduce((s, l) => {
      const amt = Number(l.debit) + Number(l.credit);
      return s + amt;
    }, 0);

    // 1. Modifier les lignes BQ existantes :
    //    - Supprimer les lignes classe 6/7
    //    - Ajouter une ligne 467 du même montant (en sens opposé à 512)
    //    - Garder les lignes tiers/512
    for (const l of odCandidates) {
      await db.delete(schema.journalLines).where(eq(schema.journalLines.id, l.id));
    }
    const maxPos = lines
      .filter((l) => !odCandidates.some((o) => o.id === l.id))
      .reduce((m, l) => Math.max(m, l.position), 0);
    await db.insert(schema.journalLines).values({
      entryId: entry.entryId,
      accountCode: "467",
      label: `Transit OD : ${entry.label}`,
      debit: direction === "debit" ? odTotal.toFixed(2) : "0.00",
      credit: direction === "debit" ? "0.00" : odTotal.toFixed(2),
      position: maxPos + 1,
    });

    // 2. Créer l'écriture OD constatation, rattachée à BQ
    const txDate = new Date(entry.date);
    const odNum = await nextEntryNumber(txDate, "OD");
    const [odEntry] = await db
      .insert(schema.journalEntries)
      .values({
        periodId: entry.periodId,
        entryNumber: odNum,
        date: entry.date,
        journal: "OD",
        label: `Constatation : ${entry.label}`,
        parentEntryId: entry.entryId,
        status: "draft",
      })
      .returning({ id: schema.journalEntries.id });

    // Lignes OD : reproduire les charges/produits + ligne 467 contrepartie
    let pos = 0;
    const odRows: Array<typeof schema.journalLines.$inferInsert> = [];
    for (const l of odCandidates) {
      odRows.push({
        entryId: odEntry.id,
        accountCode: l.accountCode,
        label: l.label,
        debit: l.debit,
        credit: l.credit,
        position: pos++,
        matchedInvoiceId: l.matchedInvoiceId,
        matchedSupplierInvoiceId: l.matchedSupplierInvoiceId,
      });
    }
    odRows.push({
      entryId: odEntry.id,
      accountCode: "467",
      label: `Transit : ${entry.label}`,
      debit: direction === "debit" ? "0.00" : odTotal.toFixed(2),
      credit: direction === "debit" ? odTotal.toFixed(2) : "0.00",
      position: pos,
    });
    await db.insert(schema.journalLines).values(odRows);

    // Mettre à jour le label BQ pour refléter qu'elle ne contient plus que le règlement
    await db
      .update(schema.journalEntries)
      .set({ label: `Règlement : ${entry.label}` })
      .where(eq(schema.journalEntries.id, entry.entryId));

    console.log(
      `  ✓ ${entry.entryNumber} migré → +OD ${odNum} (${odCandidates.length} ligne(s) class 6/7 → constatation, transit 467 = ${odTotal.toFixed(2)}€)`,
    );
    migrated++;
  }

  console.log(`\n${migrated} migrées, ${skipped} skippées.`);

  // Vérification : 467 doit être à zéro globalement après migration
  const allLines = await db
    .select({
      accountCode: schema.journalLines.accountCode,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines);
  let bal467 = 0;
  for (const l of allLines) {
    if (l.accountCode !== "467") continue;
    bal467 += Number(l.debit) - Number(l.credit);
  }
  console.log(`\nSolde 467 après migration : ${bal467.toFixed(2)} € (devrait être 0)`);

  // Vérification : les écritures BQ ne devraient plus contenir de classes 6/7
  const bqLinesWithBadAccts = await db
    .select({
      entryId: schema.journalEntries.id,
      entryNumber: schema.journalEntries.entryNumber,
      acct: schema.journalLines.accountCode,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      eq(schema.journalLines.entryId, schema.journalEntries.id),
    )
    .where(eq(schema.journalEntries.journal, "BQ"));
  const bad = bqLinesWithBadAccts.filter((r) => !isBqAccount(r.acct));
  if (bad.length > 0) {
    console.log(`\n⚠ ${bad.length} lignes "non-banque" résiduelles dans BQ :`);
    for (const b of bad) console.log(`  ${b.entryNumber} : ${b.acct}`);
  } else {
    console.log(`\n✓ Toutes les écritures BQ sont maintenant pures (banque + tiers).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
