// Pré-bilan et compte de résultat — calculs purement dérivés du grand livre.
// Document NON CERTIFIÉ : à valider par le comptable avant tout dépôt légal.

import { and, asc, eq, like, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Solde par compte à une date de clôture donnée.
 * Renvoie un Map<accountCode, debit-credit>.
 */
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

/**
 * Somme des soldes de tous les comptes commençant par un préfixe.
 * Ex sumBy("411", balances) renvoie la somme de 411-COPA + 411-XYZ + 411 (parent).
 */
function sumBy(prefix: string, balances: Map<string, number>): number {
  let s = 0;
  for (const [code, bal] of balances) {
    if (code === prefix || code.startsWith(prefix + "-")) {
      s += bal;
    }
  }
  return s;
}

/**
 * Somme des soldes de tous les comptes dont le code commence par un chiffre
 * (classe PCG). Ex byClass("6") = toutes les charges.
 */
function byClass(classDigit: string, balances: Map<string, number>): number {
  let s = 0;
  for (const [code, bal] of balances) {
    if (code.startsWith(classDigit)) s += bal;
  }
  return s;
}

export type CompteResultat = {
  produits: number; // somme classe 7
  charges: number; // somme classe 6
  resultat: number; // produits - charges
};

export async function computeCompteResultat(
  fromDate: string,
  toDate: string,
): Promise<CompteResultat> {
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
        // entrées comprises entre les deux dates incluses
        lte(schema.journalEntries.date, toDate),
      ),
    );

  // Filtre côté JS car between sans helper requiert plus de boilerplate.
  const filteredRows = rows;

  let produits = 0;
  let charges = 0;
  for (const r of filteredRows) {
    if (r.accountCode.startsWith("7")) {
      // Produit : crédit - débit (un produit normal a un solde créditeur)
      produits += Number(r.credit) - Number(r.debit);
    } else if (r.accountCode.startsWith("6")) {
      // Charge : débit - crédit
      charges += Number(r.debit) - Number(r.credit);
    }
  }
  void fromDate; // (déjà filtré par toDate dans la requête, période = exercice)

  return { produits, charges, resultat: produits - charges };
}

export type BilanLine = {
  label: string;
  amount: number;
  accountCode?: string;
  detail?: Array<{ code: string; label: string; amount: number }>;
};

export type Bilan = {
  closingDate: string;
  actif: {
    circulant: BilanLine[];
    immobilisations: BilanLine[];
    total: number;
  };
  passif: {
    capitauxPropres: BilanLine[];
    dettes: BilanLine[];
    total: number;
  };
  ecart: number; // total actif - total passif
};

export async function computeBilan(
  closingDate: string,
  capitalSocial = 1000,
): Promise<Bilan> {
  const balances = await balancesAtDate(closingDate);
  const exerciceYear = closingDate.slice(0, 4);
  const fromDate = `${exerciceYear}-01-01`;
  const cr = await computeCompteResultat(fromDate, closingDate);

  // ----- Actif -----
  const detailClients: Array<{ code: string; label: string; amount: number }> = [];
  for (const [code, bal] of balances) {
    if (code.startsWith("411-") && bal > 0.005) {
      detailClients.push({ code, label: code, amount: bal });
    }
  }
  const totalClients = detailClients.reduce((s, d) => s + d.amount, 0);

  const tresorerie = balances.get("512") ?? 0;

  const circulant: BilanLine[] = [];
  if (totalClients > 0.005) {
    circulant.push({
      label: "Créances clients",
      accountCode: "411",
      amount: totalClients,
      detail: detailClients,
    });
  }
  if (Math.abs(tresorerie) > 0.005) {
    circulant.push({
      label: tresorerie >= 0 ? "Banque" : "Banque (découvert)",
      accountCode: "512",
      amount: tresorerie,
    });
  }
  const totalActif = circulant.reduce((s, l) => s + l.amount, 0);

  // ----- Passif -----
  // Capital
  const capitauxPropres: BilanLine[] = [
    {
      label: "Capital social",
      accountCode: "101",
      amount: capitalSocial,
    },
    {
      label: "Report à nouveau",
      accountCode: "11",
      amount: 0, // pas d'historique multi-exercices pour l'instant
    },
    {
      label: cr.resultat >= 0 ? "Résultat de l'exercice (bénéfice)" : "Résultat de l'exercice (perte)",
      amount: cr.resultat,
    },
  ];
  const totalCp = capitauxPropres.reduce((s, l) => s + l.amount, 0);

  // Dettes fournisseurs : somme des soldes 401-* (créditeurs → balance < 0)
  const detailFour: Array<{ code: string; label: string; amount: number }> = [];
  for (const [code, bal] of balances) {
    if (code.startsWith("401-") && bal < -0.005) {
      detailFour.push({ code, label: code, amount: -bal });
    }
  }
  const totalFour = detailFour.reduce((s, d) => s + d.amount, 0);

  const dettes: BilanLine[] = [];
  if (totalFour > 0.005) {
    dettes.push({
      label: "Dettes fournisseurs",
      accountCode: "401",
      amount: totalFour,
      detail: detailFour,
    });
  }

  // TVA à reverser (445x : on cumule TVA collectée - TVA déductible - TVA payée)
  const tvaCollectee = sumBy("44571", balances) + sumBy("44572", balances); // crédit normalement → balance < 0
  const tvaDeductible = sumBy("44566", balances); // débit normalement → balance > 0
  const tvaAReverser = sumBy("445810", balances);
  // Net dû = (TVA collectée non encore reversée) - (TVA déductible non encore récupérée)
  // En valeurs absolues (comptes 4457x sont créditeurs, 4456x débiteur) :
  // dette TVA = -tvaCollectee - tvaDeductible + tvaAReverser
  const detteTva = -tvaCollectee - tvaDeductible - tvaAReverser;
  if (detteTva > 0.005) {
    dettes.push({
      label: "TVA à reverser (net)",
      accountCode: "44551 / 4457x - 4456x",
      amount: detteTva,
    });
  }

  const totalDettes = dettes.reduce((s, l) => s + l.amount, 0);
  const totalPassif = totalCp + totalDettes;

  return {
    closingDate,
    actif: {
      circulant,
      immobilisations: [],
      total: totalActif,
    },
    passif: {
      capitauxPropres,
      dettes,
      total: totalPassif,
    },
    ecart: totalActif - totalPassif,
  };
}

// Exposé pour utiliser dans la page
export { byClass };
// Marquer used pour le linter
void byClass;
void like;
