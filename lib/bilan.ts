// Pré-bilan formel et compte de résultat — calculs purement dérivés du grand
// livre. Format inspiré des tableaux 2050 (bilan) et 2052 (compte de résultat)
// de la liasse fiscale française. Tous les rubriques apparaissent même si à
// zéro pour LCD (pas d'immo, pas de stocks, pas de salariés à ce jour).
//
// DOCUMENT NON CERTIFIÉ — à valider par l'expert-comptable avant tout dépôt.

import { and, asc, eq, gte, like, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getExercicePeriod } from "@/lib/accounting";

// ============================================================================
// Helpers de base
// ============================================================================

export async function balancesAtDate(
  closingDate: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountCode: schema.journalLines.accountCode,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      eq(schema.journalLines.entryId, schema.journalEntries.id),
    )
    .where(lte(schema.journalEntries.date, closingDate))
    .orderBy(asc(schema.journalLines.accountCode));

  const balances = new Map<string, number>();
  for (const r of rows) {
    const cur = balances.get(r.accountCode) ?? 0;
    balances.set(r.accountCode, cur + Number(r.debit) - Number(r.credit));
  }
  return balances;
}

function sumWhere(
  balances: Map<string, number>,
  pred: (code: string) => boolean,
): number {
  let s = 0;
  for (const [code, bal] of balances) {
    if (pred(code)) s += bal;
  }
  return s;
}

const startsWith = (prefixes: string[]) => (code: string) =>
  prefixes.some((p) => code === p || code.startsWith(p));

async function periodBalances(
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountCode: schema.journalLines.accountCode,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      eq(schema.journalLines.entryId, schema.journalEntries.id),
    )
    .where(
      and(
        gte(schema.journalEntries.date, fromDate),
        lte(schema.journalEntries.date, toDate),
      ),
    );
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(
      r.accountCode,
      (map.get(r.accountCode) ?? 0) + Number(r.debit) - Number(r.credit),
    );
  }
  return map;
}

// ============================================================================
// Compte de résultat — types
// ============================================================================

export type CompteResultatLine = {
  accountCode: string;
  label: string;
  amount: number;
};

export type CompteResultat = {
  produits: number;
  charges: number;
  resultat: number;
  produitsLines: CompteResultatLine[];
  chargesLines: CompteResultatLine[];
};

export async function computeCompteResultat(
  fromDate: string,
  toDate: string,
): Promise<CompteResultat> {
  const period = await periodBalances(fromDate, toDate);
  const accounts = await db.query.chartOfAccounts.findMany({
    columns: { code: true, label: true },
  });
  const labelByCode = new Map(accounts.map((a) => [a.code, a.label]));

  const produitsByAccount = new Map<string, number>();
  const chargesByAccount = new Map<string, number>();
  for (const [code, bal] of period) {
    if (code.startsWith("7")) produitsByAccount.set(code, -bal);
    else if (code.startsWith("6")) chargesByAccount.set(code, bal);
  }

  const produitsLines: CompteResultatLine[] = [...produitsByAccount.entries()]
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([code, amount]) => ({
      accountCode: code,
      label: labelByCode.get(code) ?? code,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);
  const chargesLines: CompteResultatLine[] = [...chargesByAccount.entries()]
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([code, amount]) => ({
      accountCode: code,
      label: labelByCode.get(code) ?? code,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const produits = produitsLines.reduce((s, l) => s + l.amount, 0);
  const charges = chargesLines.reduce((s, l) => s + l.amount, 0);

  return { produits, charges, resultat: produits - charges, produitsLines, chargesLines };
}

// ============================================================================
// Bilan formel
// ============================================================================

export type BilanRow = {
  label: string;
  level: 0 | 1 | 2;
  accountHint?: string;
  netN: number;
  netN1: number;
  isHeader?: boolean;
  isSubtotal?: boolean;
  isGrandTotal?: boolean;
};

export type BilanFormel = {
  exercice: number;
  closingDate: string;
  closingDateN1: string;
  actif: BilanRow[];
  passif: BilanRow[];
  totalActifN: number;
  totalActifN1: number;
  totalPassifN: number;
  totalPassifN1: number;
};

export async function computeBilanFormel(
  exercice: number,
  capitalSocial = 1000,
): Promise<BilanFormel> {
  const periodN = await getExercicePeriod(exercice);
  const periodN1 = await getExercicePeriod(exercice - 1);
  const closing = periodN.endDate;
  const closingN1 = periodN1.endDate;
  const [balN, balN1] = await Promise.all([
    balancesAtDate(closing),
    balancesAtDate(closingN1),
  ]);
  const [crN, crN1] = await Promise.all([
    computeCompteResultat(periodN.startDate, closing).then((c) => c.resultat),
    computeCompteResultat(periodN1.startDate, closingN1).then((c) => c.resultat),
  ]);

  // ACTIF
  const actif: BilanRow[] = [];
  // -- Capital souscrit non appelé
  actif.push({
    label: "Capital souscrit non appelé",
    level: 1,
    accountHint: "109",
    netN: -sumWhere(balN, (c) => c === "109"),
    netN1: -sumWhere(balN1, (c) => c === "109"),
  });
  // -- Actif immobilisé
  actif.push({ label: "ACTIF IMMOBILISÉ", level: 0, netN: 0, netN1: 0, isHeader: true });
  const immoIncN = sumWhere(balN, startsWith(["20"]));
  const immoIncN1 = sumWhere(balN1, startsWith(["20"]));
  actif.push({ label: "Immobilisations incorporelles", level: 1, accountHint: "20*", netN: immoIncN, netN1: immoIncN1 });
  const immoCorN = sumWhere(balN, startsWith(["21", "23"]));
  const immoCorN1 = sumWhere(balN1, startsWith(["21", "23"]));
  actif.push({ label: "Immobilisations corporelles", level: 1, accountHint: "21, 23", netN: immoCorN, netN1: immoCorN1 });
  const immoFinN = sumWhere(balN, startsWith(["26", "27"]));
  const immoFinN1 = sumWhere(balN1, startsWith(["26", "27"]));
  actif.push({ label: "Immobilisations financières", level: 1, accountHint: "26, 27", netN: immoFinN, netN1: immoFinN1 });
  const totalImmoN = immoIncN + immoCorN + immoFinN;
  const totalImmoN1 = immoIncN1 + immoCorN1 + immoFinN1;
  actif.push({ label: "Total I — Actif immobilisé", level: 1, netN: totalImmoN, netN1: totalImmoN1, isSubtotal: true });

  // -- Actif circulant
  actif.push({ label: "ACTIF CIRCULANT", level: 0, netN: 0, netN1: 0, isHeader: true });
  const stocksN = sumWhere(balN, startsWith(["3"]));
  const stocksN1 = sumWhere(balN1, startsWith(["3"]));
  actif.push({ label: "Stocks (matières, en-cours, marchandises)", level: 1, accountHint: "3*", netN: stocksN, netN1: stocksN1 });
  const avAcN = sumWhere(balN, startsWith(["4091"]));
  const avAcN1 = sumWhere(balN1, startsWith(["4091"]));
  actif.push({ label: "Avances et acomptes versés sur commandes", level: 1, accountHint: "4091", netN: avAcN, netN1: avAcN1 });
  const creancesN = Math.max(0, sumWhere(balN, startsWith(["411"])));
  const creancesN1 = Math.max(0, sumWhere(balN1, startsWith(["411"])));
  actif.push({ label: "Créances clients et comptes rattachés", level: 1, accountHint: "411-*", netN: creancesN, netN1: creancesN1 });
  const tvaDedN = Math.max(0, sumWhere(balN, startsWith(["44566"])));
  const tvaDedN1 = Math.max(0, sumWhere(balN1, startsWith(["44566"])));
  actif.push({ label: "Autres créances (dont TVA déductible)", level: 1, accountHint: "44566, 462", netN: tvaDedN, netN1: tvaDedN1 });
  const dispoN = Math.max(0, sumWhere(balN, startsWith(["512", "53"])));
  const dispoN1 = Math.max(0, sumWhere(balN1, startsWith(["512", "53"])));
  actif.push({ label: "Disponibilités", level: 1, accountHint: "512, 53", netN: dispoN, netN1: dispoN1 });
  const ccaN = sumWhere(balN, startsWith(["486"]));
  const ccaN1 = sumWhere(balN1, startsWith(["486"]));
  actif.push({ label: "Charges constatées d'avance", level: 1, accountHint: "486", netN: ccaN, netN1: ccaN1 });
  const totalCircN = stocksN + avAcN + creancesN + tvaDedN + dispoN + ccaN;
  const totalCircN1 = stocksN1 + avAcN1 + creancesN1 + tvaDedN1 + dispoN1 + ccaN1;
  actif.push({ label: "Total II — Actif circulant", level: 1, netN: totalCircN, netN1: totalCircN1, isSubtotal: true });

  const totalActifN = totalImmoN + totalCircN;
  const totalActifN1 = totalImmoN1 + totalCircN1;
  actif.push({ label: "TOTAL ACTIF", level: 0, netN: totalActifN, netN1: totalActifN1, isGrandTotal: true });

  // PASSIF
  const passif: BilanRow[] = [];
  // -- Capitaux propres
  passif.push({ label: "CAPITAUX PROPRES", level: 0, netN: 0, netN1: 0, isHeader: true });
  passif.push({ label: "Capital social", level: 1, accountHint: "101", netN: capitalSocial, netN1: capitalSocial });
  passif.push({
    label: "Primes d'émission, de fusion, d'apport",
    level: 1,
    accountHint: "104",
    netN: -sumWhere(balN, startsWith(["104"])),
    netN1: -sumWhere(balN1, startsWith(["104"])),
  });
  passif.push({
    label: "Écarts de réévaluation",
    level: 1,
    accountHint: "105",
    netN: -sumWhere(balN, startsWith(["105"])),
    netN1: -sumWhere(balN1, startsWith(["105"])),
  });
  passif.push({
    label: "Réserves (légale, statutaire, autres)",
    level: 1,
    accountHint: "106",
    netN: -sumWhere(balN, startsWith(["106"])),
    netN1: -sumWhere(balN1, startsWith(["106"])),
  });
  passif.push({
    label: "Report à nouveau",
    level: 1,
    accountHint: "11",
    netN: -sumWhere(balN, startsWith(["11"])),
    netN1: -sumWhere(balN1, startsWith(["11"])),
  });
  passif.push({
    label: `Résultat de l'exercice (${crN >= 0 ? "bénéfice" : "perte"})`,
    level: 1,
    accountHint: "12",
    netN: crN,
    netN1: crN1,
  });
  passif.push({
    label: "Subventions d'investissement",
    level: 1,
    accountHint: "13",
    netN: -sumWhere(balN, startsWith(["13"])),
    netN1: -sumWhere(balN1, startsWith(["13"])),
  });
  passif.push({
    label: "Provisions réglementées",
    level: 1,
    accountHint: "14",
    netN: -sumWhere(balN, startsWith(["14"])),
    netN1: -sumWhere(balN1, startsWith(["14"])),
  });
  const totalCpN =
    capitalSocial + crN -
    sumWhere(balN, startsWith(["104", "105", "106", "11", "13", "14"]));
  const totalCpN1 =
    capitalSocial + crN1 -
    sumWhere(balN1, startsWith(["104", "105", "106", "11", "13", "14"]));
  passif.push({ label: "Total I — Capitaux propres", level: 1, netN: totalCpN, netN1: totalCpN1, isSubtotal: true });

  // -- Provisions
  passif.push({ label: "PROVISIONS", level: 0, netN: 0, netN1: 0, isHeader: true });
  const provN = -sumWhere(balN, startsWith(["15"]));
  const provN1 = -sumWhere(balN1, startsWith(["15"]));
  passif.push({ label: "Provisions pour risques et charges", level: 1, accountHint: "15", netN: provN, netN1: provN1 });
  passif.push({ label: "Total II — Provisions", level: 1, netN: provN, netN1: provN1, isSubtotal: true });

  // -- Dettes
  passif.push({ label: "DETTES", level: 0, netN: 0, netN1: 0, isHeader: true });
  const empN = -sumWhere(balN, startsWith(["16"]));
  const empN1 = -sumWhere(balN1, startsWith(["16"]));
  passif.push({ label: "Emprunts et dettes financières", level: 1, accountHint: "16*", netN: empN, netN1: empN1 });
  const avRecN = -sumWhere(balN, startsWith(["4191"]));
  const avRecN1 = -sumWhere(balN1, startsWith(["4191"]));
  passif.push({ label: "Avances et acomptes reçus sur commandes", level: 1, accountHint: "4191", netN: avRecN, netN1: avRecN1 });
  const dettFourN = Math.max(0, -sumWhere(balN, startsWith(["401"])));
  const dettFourN1 = Math.max(0, -sumWhere(balN1, startsWith(["401"])));
  passif.push({ label: "Dettes fournisseurs et comptes rattachés", level: 1, accountHint: "401-*", netN: dettFourN, netN1: dettFourN1 });
  // Dette TVA = TVA collectée - TVA déductible (uniquement si solde net dû)
  const tvaCollN = -sumWhere(balN, startsWith(["44571", "44572"]));
  const tvaCollN1 = -sumWhere(balN1, startsWith(["44571", "44572"]));
  const tvaAVerserN = -sumWhere(balN, startsWith(["445"]));
  const tvaAVerserN1 = -sumWhere(balN1, startsWith(["445"]));
  const dettFiscN = Math.max(0, tvaCollN - tvaDedN + tvaAVerserN) +
    Math.max(0, -sumWhere(balN, startsWith(["42", "43", "447"])));
  const dettFiscN1 = Math.max(0, tvaCollN1 - tvaDedN1 + tvaAVerserN1) +
    Math.max(0, -sumWhere(balN1, startsWith(["42", "43", "447"])));
  passif.push({ label: "Dettes fiscales et sociales", level: 1, accountHint: "44, 42, 43", netN: dettFiscN, netN1: dettFiscN1 });
  const dettImmoN = Math.max(0, -sumWhere(balN, startsWith(["404"])));
  const dettImmoN1 = Math.max(0, -sumWhere(balN1, startsWith(["404"])));
  passif.push({ label: "Dettes sur immobilisations", level: 1, accountHint: "404", netN: dettImmoN, netN1: dettImmoN1 });
  const autresDettN = Math.max(0, -sumWhere(balN, startsWith(["467"])));
  const autresDettN1 = Math.max(0, -sumWhere(balN1, startsWith(["467"])));
  passif.push({ label: "Autres dettes", level: 1, accountHint: "467", netN: autresDettN, netN1: autresDettN1 });
  const pcaN = -sumWhere(balN, startsWith(["487"]));
  const pcaN1 = -sumWhere(balN1, startsWith(["487"]));
  passif.push({ label: "Produits constatés d'avance", level: 1, accountHint: "487", netN: pcaN, netN1: pcaN1 });
  const totalDettN = empN + avRecN + dettFourN + dettFiscN + dettImmoN + autresDettN + pcaN;
  const totalDettN1 = empN1 + avRecN1 + dettFourN1 + dettFiscN1 + dettImmoN1 + autresDettN1 + pcaN1;
  passif.push({ label: "Total IV — Dettes", level: 1, netN: totalDettN, netN1: totalDettN1, isSubtotal: true });

  const totalPassifN = totalCpN + provN + totalDettN;
  const totalPassifN1 = totalCpN1 + provN1 + totalDettN1;
  passif.push({ label: "TOTAL PASSIF", level: 0, netN: totalPassifN, netN1: totalPassifN1, isGrandTotal: true });

  return {
    exercice,
    closingDate: closing,
    closingDateN1: closingN1,
    actif,
    passif,
    totalActifN,
    totalActifN1,
    totalPassifN,
    totalPassifN1,
  };
}

// ============================================================================
// Compte de résultat formel
// ============================================================================

export type CompteResultatRow = {
  label: string;
  level: 0 | 1;
  accountHint?: string;
  amountN: number;
  amountN1: number;
  isHeader?: boolean;
  isSubtotal?: boolean;
  isGrandTotal?: boolean;
};

export type CompteResultatFormel = {
  exercice: number;
  produits: CompteResultatRow[];
  charges: CompteResultatRow[];
  totalProduitsN: number;
  totalProduitsN1: number;
  totalChargesN: number;
  totalChargesN1: number;
  resultatExploitationN: number;
  resultatExploitationN1: number;
  resultatFinancierN: number;
  resultatFinancierN1: number;
  resultatExceptionnelN: number;
  resultatExceptionnelN1: number;
  resultatNetN: number;
  resultatNetN1: number;
  produitsLines: CompteResultatLine[];
  chargesLines: CompteResultatLine[];
};

export async function computeCompteResultatFormel(
  exercice: number,
): Promise<CompteResultatFormel> {
  const periodN = await getExercicePeriod(exercice);
  const periodN1 = await getExercicePeriod(exercice - 1);
  const fromN = periodN.startDate;
  const toN = periodN.endDate;
  const fromN1 = periodN1.startDate;
  const toN1 = periodN1.endDate;

  const [perN, perN1, baseCR] = await Promise.all([
    periodBalances(fromN, toN),
    periodBalances(fromN1, toN1),
    computeCompteResultat(fromN, toN),
  ]);

  const sumP = (
    map: Map<string, number>,
    pred: (code: string) => boolean,
  ): number =>
    [...map.entries()]
      .filter(([code]) => pred(code))
      .reduce((s, [, v]) => s - v, 0);

  const sumC = (
    map: Map<string, number>,
    pred: (code: string) => boolean,
  ): number =>
    [...map.entries()]
      .filter(([code]) => pred(code))
      .reduce((s, [, v]) => s + v, 0);

  const produits: CompteResultatRow[] = [];
  produits.push({ label: "PRODUITS D'EXPLOITATION", level: 0, isHeader: true, amountN: 0, amountN1: 0 });
  produits.push({ label: "Ventes de marchandises", level: 1, accountHint: "707", amountN: sumP(perN, startsWith(["707"])), amountN1: sumP(perN1, startsWith(["707"])) });
  produits.push({ label: "Production vendue (biens et services)", level: 1, accountHint: "701-706", amountN: sumP(perN, (c) => /^70[1-6]/.test(c)), amountN1: sumP(perN1, (c) => /^70[1-6]/.test(c)) });
  produits.push({ label: "Production stockée / immobilisée", level: 1, accountHint: "71, 72", amountN: sumP(perN, startsWith(["71", "72"])), amountN1: sumP(perN1, startsWith(["71", "72"])) });
  produits.push({ label: "Subventions d'exploitation", level: 1, accountHint: "74", amountN: sumP(perN, startsWith(["74"])), amountN1: sumP(perN1, startsWith(["74"])) });
  produits.push({ label: "Reprises sur amortissements et provisions", level: 1, accountHint: "78", amountN: sumP(perN, startsWith(["78"])), amountN1: sumP(perN1, startsWith(["78"])) });
  produits.push({ label: "Autres produits", level: 1, accountHint: "75", amountN: sumP(perN, startsWith(["75"])), amountN1: sumP(perN1, startsWith(["75"])) });
  const totProdExpN = produits.slice(1).reduce((s, r) => s + r.amountN, 0);
  const totProdExpN1 = produits.slice(1).reduce((s, r) => s + r.amountN1, 0);
  produits.push({ label: "Total produits d'exploitation", level: 1, amountN: totProdExpN, amountN1: totProdExpN1, isSubtotal: true });

  produits.push({ label: "PRODUITS FINANCIERS", level: 0, isHeader: true, amountN: 0, amountN1: 0 });
  const prodFinN = sumP(perN, startsWith(["76"]));
  const prodFinN1 = sumP(perN1, startsWith(["76"]));
  produits.push({ label: "Produits financiers", level: 1, accountHint: "76", amountN: prodFinN, amountN1: prodFinN1, isSubtotal: true });

  produits.push({ label: "PRODUITS EXCEPTIONNELS", level: 0, isHeader: true, amountN: 0, amountN1: 0 });
  const prodExcN = sumP(perN, startsWith(["77"]));
  const prodExcN1 = sumP(perN1, startsWith(["77"]));
  produits.push({ label: "Produits exceptionnels", level: 1, accountHint: "77", amountN: prodExcN, amountN1: prodExcN1, isSubtotal: true });

  const totalProduitsN = totProdExpN + prodFinN + prodExcN;
  const totalProduitsN1 = totProdExpN1 + prodFinN1 + prodExcN1;
  produits.push({ label: "TOTAL PRODUITS", level: 0, amountN: totalProduitsN, amountN1: totalProduitsN1, isGrandTotal: true });

  const charges: CompteResultatRow[] = [];
  charges.push({ label: "CHARGES D'EXPLOITATION", level: 0, isHeader: true, amountN: 0, amountN1: 0 });
  charges.push({ label: "Achats de marchandises", level: 1, accountHint: "607", amountN: sumC(perN, startsWith(["607"])), amountN1: sumC(perN1, startsWith(["607"])) });
  charges.push({ label: "Achats de matières et autres approvisionnements", level: 1, accountHint: "601-606", amountN: sumC(perN, (c) => /^60[1-6]/.test(c)), amountN1: sumC(perN1, (c) => /^60[1-6]/.test(c)) });
  charges.push({
    label: "Transports de biens (sur achats et ventes)",
    level: 1,
    accountHint: "624",
    amountN: sumC(perN, startsWith(["624"])),
    amountN1: sumC(perN1, startsWith(["624"])),
  });
  // 61-62 hors 624 (déjà sorti sur sa propre ligne)
  charges.push({
    label: "Autres achats et charges externes",
    level: 1,
    accountHint: "61, 62 (hors 624)",
    amountN: sumC(
      perN,
      (c) => (c.startsWith("61") || c.startsWith("62")) && !c.startsWith("624"),
    ),
    amountN1: sumC(
      perN1,
      (c) => (c.startsWith("61") || c.startsWith("62")) && !c.startsWith("624"),
    ),
  });
  charges.push({ label: "Impôts, taxes et versements assimilés", level: 1, accountHint: "63", amountN: sumC(perN, startsWith(["63"])), amountN1: sumC(perN1, startsWith(["63"])) });
  charges.push({ label: "Salaires et traitements", level: 1, accountHint: "641", amountN: sumC(perN, startsWith(["641"])), amountN1: sumC(perN1, startsWith(["641"])) });
  charges.push({ label: "Charges sociales", level: 1, accountHint: "645-648", amountN: sumC(perN, (c) => /^64[5-8]/.test(c)), amountN1: sumC(perN1, (c) => /^64[5-8]/.test(c)) });
  charges.push({ label: "Dotations aux amortissements et provisions", level: 1, accountHint: "68", amountN: sumC(perN, startsWith(["68"])), amountN1: sumC(perN1, startsWith(["68"])) });
  charges.push({ label: "Autres charges", level: 1, accountHint: "65", amountN: sumC(perN, startsWith(["65"])), amountN1: sumC(perN1, startsWith(["65"])) });
  const totChExpN = charges.slice(1).reduce((s, r) => s + r.amountN, 0);
  const totChExpN1 = charges.slice(1).reduce((s, r) => s + r.amountN1, 0);
  charges.push({ label: "Total charges d'exploitation", level: 1, amountN: totChExpN, amountN1: totChExpN1, isSubtotal: true });

  charges.push({ label: "CHARGES FINANCIÈRES", level: 0, isHeader: true, amountN: 0, amountN1: 0 });
  const chFinN = sumC(perN, startsWith(["66"]));
  const chFinN1 = sumC(perN1, startsWith(["66"]));
  charges.push({ label: "Charges financières", level: 1, accountHint: "66", amountN: chFinN, amountN1: chFinN1, isSubtotal: true });

  charges.push({ label: "CHARGES EXCEPTIONNELLES", level: 0, isHeader: true, amountN: 0, amountN1: 0 });
  const chExcN = sumC(perN, startsWith(["67"]));
  const chExcN1 = sumC(perN1, startsWith(["67"]));
  charges.push({ label: "Charges exceptionnelles", level: 1, accountHint: "67", amountN: chExcN, amountN1: chExcN1, isSubtotal: true });

  charges.push({ label: "IMPÔT SUR LES BÉNÉFICES", level: 0, isHeader: true, amountN: 0, amountN1: 0 });
  const isN = sumC(perN, startsWith(["695", "699"]));
  const isN1 = sumC(perN1, startsWith(["695", "699"]));
  charges.push({ label: "Impôt sur les sociétés", level: 1, accountHint: "695", amountN: isN, amountN1: isN1, isSubtotal: true });

  const totalChargesN = totChExpN + chFinN + chExcN + isN;
  const totalChargesN1 = totChExpN1 + chFinN1 + chExcN1 + isN1;
  charges.push({ label: "TOTAL CHARGES", level: 0, amountN: totalChargesN, amountN1: totalChargesN1, isGrandTotal: true });

  return {
    exercice,
    produits,
    charges,
    totalProduitsN,
    totalProduitsN1,
    totalChargesN,
    totalChargesN1,
    resultatExploitationN: totProdExpN - totChExpN,
    resultatExploitationN1: totProdExpN1 - totChExpN1,
    resultatFinancierN: prodFinN - chFinN,
    resultatFinancierN1: prodFinN1 - chFinN1,
    resultatExceptionnelN: prodExcN - chExcN,
    resultatExceptionnelN1: prodExcN1 - chExcN1,
    resultatNetN: totalProduitsN - totalChargesN,
    resultatNetN1: totalProduitsN1 - totalChargesN1,
    produitsLines: baseCR.produitsLines,
    chargesLines: baseCR.chargesLines,
  };
}

// ============================================================================
// Compat avec les routes existantes (computeBilan ancien format)
// ============================================================================

export type BilanLine = {
  label: string;
  amount: number;
  accountCode?: string;
  detail?: Array<{ code: string; label: string; amount: number }>;
};

export type Bilan = {
  closingDate: string;
  actif: { circulant: BilanLine[]; immobilisations: BilanLine[]; total: number };
  passif: { capitauxPropres: BilanLine[]; dettes: BilanLine[]; total: number };
  ecart: number;
};

/** @deprecated Préférer computeBilanFormel. Conservé pour compat exports. */
export async function computeBilan(
  closingDate: string,
  capitalSocial = 1000,
): Promise<Bilan> {
  const exercice = Number.parseInt(closingDate.slice(0, 4), 10);
  const f = await computeBilanFormel(exercice, capitalSocial);
  const toLines = (rows: BilanRow[], filter: (r: BilanRow) => boolean): BilanLine[] =>
    rows
      .filter(
        (r) =>
          r.level === 1 &&
          !r.isSubtotal &&
          !r.isGrandTotal &&
          filter(r) &&
          Math.abs(r.netN) > 0.005,
      )
      .map((r) => ({ label: r.label, amount: r.netN, accountCode: r.accountHint }));
  return {
    closingDate,
    actif: {
      circulant: toLines(f.actif, (r) =>
        ["Stocks", "Avances", "Créances", "Autres créances", "Disponibilités", "Charges constatées"].some((k) => r.label.startsWith(k)),
      ),
      immobilisations: toLines(f.actif, (r) => r.label.startsWith("Immobilisations")),
      total: f.totalActifN,
    },
    passif: {
      capitauxPropres: toLines(f.passif, (r) =>
        ["Capital", "Primes", "Écarts", "Réserves", "Report", "Résultat", "Subventions", "Provisions réglementées"].some((k) => r.label.startsWith(k)),
      ),
      dettes: toLines(f.passif, (r) =>
        ["Emprunts", "Avances", "Dettes", "Produits constatés"].some((k) => r.label.startsWith(k)),
      ),
      total: f.totalPassifN,
    },
    ecart: f.totalActifN - f.totalPassifN,
  };
}

// Suppress unused imports if any
void like;
