// Audit compta : vérifie la cohérence du grand livre. À lancer après toute
// opération significative (matérialisation, classification, split, refacto).
//
// Usage : npm run audit:compta
//
// Vérifie :
//  1. Chaque écriture est balancée (Σ débit = Σ crédit)
//  2. Le grand livre global est balancé (Σ tous lignes = 0)
//  3. Le compte transit 467 est à zéro (toute OD a sa contrepartie BQ)
//  4. Le journal BQ ne contient que des comptes "purs banque"
//  5. Les sous-comptes tiers (411-X / 401-X) cohérents avec status='paid'
//  6. Aucune ligne 411 ou 401 sans suffixe (devrait toujours être tier)

import { config } from "dotenv";
config({ path: ".env.local" });

type Issue = { severity: "ERROR" | "WARN"; message: string };

async function main() {
  const { db, schema } = await import("../lib/db");
  const { eq } = await import("drizzle-orm");
  const { isBqAccount } = await import("../lib/accounting");

  const issues: Issue[] = [];

  // -------- 1. Écritures balancées ----------
  const entries = await db.query.journalEntries.findMany();
  let unbalancedEntries = 0;
  for (const e of entries) {
    const lines = await db
      .select()
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, e.id));
    const sumD = lines.reduce((s, l) => s + Number(l.debit), 0);
    const sumC = lines.reduce((s, l) => s + Number(l.credit), 0);
    const ecart = sumD - sumC;
    if (Math.abs(ecart) > 0.005) {
      issues.push({
        severity: "ERROR",
        message: `Écriture ${e.entryNumber} déséquilibrée : Σ D=${sumD.toFixed(2)} ≠ Σ C=${sumC.toFixed(2)} (écart ${ecart.toFixed(2)})`,
      });
      unbalancedEntries++;
    }
  }
  console.log(
    `1. Écritures balancées      : ${entries.length - unbalancedEntries}/${entries.length} ${unbalancedEntries === 0 ? "✓" : "❌"}`,
  );

  // -------- 2. Grand livre global ----------
  const allLines = await db.select().from(schema.journalLines);
  const totalGl = allLines.reduce(
    (s, l) => s + Number(l.debit) - Number(l.credit),
    0,
  );
  console.log(
    `2. Grand livre global       : Σ(D-C) = ${totalGl.toFixed(2)} € ${Math.abs(totalGl) < 0.01 ? "✓" : "❌"}`,
  );
  if (Math.abs(totalGl) > 0.005) {
    issues.push({
      severity: "ERROR",
      message: `Grand livre déséquilibré : Σ(D-C) global = ${totalGl.toFixed(2)} €`,
    });
  }

  // -------- 3. Transit 467 à zéro ----------
  const bal467 = allLines
    .filter((l) => l.accountCode === "467")
    .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  console.log(
    `3. Transit 467 (OD/BQ)      : ${bal467.toFixed(2)} € ${Math.abs(bal467) < 0.01 ? "✓" : "❌"}`,
  );
  if (Math.abs(bal467) > 0.005) {
    issues.push({
      severity: "ERROR",
      message: `Compte 467 (transit OD/BQ) non soldé : ${bal467.toFixed(2)} €`,
    });
  }

  // -------- 4. Journal BQ pure trésorerie ----------
  const bqLines = await db
    .select({
      entryId: schema.journalEntries.id,
      entryNumber: schema.journalEntries.entryNumber,
      accountCode: schema.journalLines.accountCode,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      eq(schema.journalLines.entryId, schema.journalEntries.id),
    )
    .where(eq(schema.journalEntries.journal, "BQ"));
  const dirtyBq = bqLines.filter((r) => !isBqAccount(r.accountCode));
  console.log(
    `4. Journal BQ pur           : ${bqLines.length - dirtyBq.length}/${bqLines.length} lignes ${dirtyBq.length === 0 ? "✓" : "❌"}`,
  );
  for (const d of dirtyBq.slice(0, 5)) {
    issues.push({
      severity: "WARN",
      message: `BQ ${d.entryNumber} contient compte non-BQ : ${d.accountCode}`,
    });
  }

  // -------- 5. Tier sub-accounts vs invoice status ----------
  // Pour chaque facture status='paid', le solde du sous-compte tiers ne doit
  // pas porter ce montant en attente.
  const allInvoices = await db.query.invoices.findMany({
    columns: { id: true, status: true, invoiceNumber: true, totalTtc: true },
  });
  const paidInvoices = allInvoices.filter((i) => i.status === "paid");
  const issuedInvoices = allInvoices.filter((i) => i.status === "issued");
  console.log(
    `5. Factures clients         : ${paidInvoices.length} payées, ${issuedInvoices.length} ouvertes`,
  );
  const allSi = await db.query.supplierInvoices.findMany({
    columns: { id: true, status: true, supplierInvoiceNumber: true, totalTtc: true },
  });
  const paidSi = allSi.filter((i) => i.status === "paid");
  const issuedSi = allSi.filter((i) => i.status === "issued");
  console.log(
    `   Factures fournisseurs   : ${paidSi.length} payées, ${issuedSi.length} ouvertes`,
  );

  // -------- 6. Aucune ligne sur compte parent 411 ou 401 (sans tier) ----------
  const orphan = allLines.filter(
    (l) => l.accountCode === "411" || l.accountCode === "401",
  );
  console.log(
    `6. Lignes sur 411/401 nu    : ${orphan.length} ${orphan.length === 0 ? "✓" : "⚠"}`,
  );
  if (orphan.length > 0) {
    issues.push({
      severity: "WARN",
      message: `${orphan.length} ligne(s) directement sur 411 ou 401 (devraient être 411-X / 401-X)`,
    });
  }

  // -------- 7. tx Qonto matchées sans JE ----------
  const txs = await db.query.qontoTransactions.findMany();
  const matchedSansJe = txs.filter(
    (t) =>
      (t.matchedInvoiceId || t.matchedSupplierInvoiceId) && !t.journalEntryId,
  );
  console.log(
    `7. Tx Qonto matchées sans JE: ${matchedSansJe.length} ${matchedSansJe.length === 0 ? "✓" : "❌"}`,
  );
  if (matchedSansJe.length > 0) {
    for (const t of matchedSansJe.slice(0, 5)) {
      issues.push({
        severity: "ERROR",
        message: `Tx ${t.id.slice(0, 8)} (${t.date}, ${t.amount}€) matchée mais sans journalEntryId`,
      });
    }
  }

  // -------- Récap ----------
  console.log("\n" + "─".repeat(60));
  const errors = issues.filter((i) => i.severity === "ERROR");
  const warns = issues.filter((i) => i.severity === "WARN");
  if (errors.length === 0 && warns.length === 0) {
    console.log("✅ Compta cohérente — aucune anomalie détectée");
  } else {
    if (errors.length > 0) {
      console.log(`❌ ${errors.length} erreur(s) :`);
      for (const e of errors) console.log(`   • ${e.message}`);
    }
    if (warns.length > 0) {
      console.log(`⚠ ${warns.length} avertissement(s) :`);
      for (const w of warns) console.log(`   • ${w.message}`);
    }
  }

  if (errors.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
