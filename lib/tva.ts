// Calcul des déclarations TVA mensuelles à partir des factures émises et reçues
// sur l'exercice. Lecture du taux ligne par ligne via vatBreakdown — pas de
// supposition de taux uniforme à 20%.
//
// Régime Corse (art. 297 CGI) : 2,1% pour denrées alimentaires livrées en
// Corse, 20% pour le reste. Les autres taux (5,5%, 10%) sont gérés mais ne
// sont pas attendus sur le catalogue actuel.

import { and, asc, between, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type TvaMonth = {
  monthKey: string; // "2025-01"
  monthLabel: string; // "Janvier 2025"
  collected: Record<string, number>; // rate "20.00" → montant TVA collectée
  deductible: Record<string, number>; // rate "20.00" → montant TVA déductible
  collectedTotal: number;
  deductibleTotal: number;
  net: number; // > 0 = à reverser, < 0 = crédit
};

function monthLabel(year: number, monthIdx0: number): string {
  const monthsFr = [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
  ];
  return `${monthsFr[monthIdx0]} ${year}`;
}

export async function computeTvaForYear(year: number): Promise<{
  months: TvaMonth[];
  yearly: {
    collected: Record<string, number>;
    deductible: Record<string, number>;
    collectedTotal: number;
    deductibleTotal: number;
    net: number;
  };
}> {
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;

  // Initialiser les 12 mois vides
  const monthsMap = new Map<string, TvaMonth>();
  for (let m = 0; m < 12; m++) {
    const key = `${year}-${(m + 1).toString().padStart(2, "0")}`;
    monthsMap.set(key, {
      monthKey: key,
      monthLabel: monthLabel(year, m),
      collected: {},
      deductible: {},
      collectedTotal: 0,
      deductibleTotal: 0,
      net: 0,
    });
  }

  // Factures clients (TVA collectée) — par mois d'émission
  const clientInvoices = await db
    .select({
      issueDate: schema.invoices.issueDate,
      vatBreakdown: schema.invoices.vatBreakdown,
    })
    .from(schema.invoices)
    .where(
      and(
        between(schema.invoices.issueDate, fromDate, toDate),
        // Exclure les avoirs ? Pour l'instant on les prend (avec montant négatif si applicable)
      ),
    )
    .orderBy(asc(schema.invoices.issueDate));

  for (const inv of clientInvoices) {
    const monthKey = inv.issueDate.slice(0, 7);
    const m = monthsMap.get(monthKey);
    if (!m) continue;
    for (const b of inv.vatBreakdown ?? []) {
      const rate = Number(b.rate).toFixed(2);
      const amount = Number(b.vat);
      m.collected[rate] = (m.collected[rate] ?? 0) + amount;
      m.collectedTotal += amount;
    }
  }

  // Factures fournisseurs (TVA déductible)
  const supplierInvoices = await db
    .select({
      issueDate: schema.supplierInvoices.issueDate,
      vatBreakdown: schema.supplierInvoices.vatBreakdown,
      totalVat: schema.supplierInvoices.totalVat,
    })
    .from(schema.supplierInvoices)
    .where(between(schema.supplierInvoices.issueDate, fromDate, toDate))
    .orderBy(asc(schema.supplierInvoices.issueDate));

  for (const inv of supplierInvoices) {
    const monthKey = inv.issueDate.slice(0, 7);
    const m = monthsMap.get(monthKey);
    if (!m) continue;
    if ((inv.vatBreakdown?.length ?? 0) > 0) {
      for (const b of inv.vatBreakdown!) {
        const rate = Number(b.rate).toFixed(2);
        const amount = Number(b.vat);
        m.deductible[rate] = (m.deductible[rate] ?? 0) + amount;
        m.deductibleTotal += amount;
      }
    } else if (Number(inv.totalVat) > 0) {
      // Fallback : pas de ventilation → on suppose 20% (à valider)
      const rate = "20.00";
      const amount = Number(inv.totalVat);
      m.deductible[rate] = (m.deductible[rate] ?? 0) + amount;
      m.deductibleTotal += amount;
    }
  }

  // Calculer le net par mois
  const months = Array.from(monthsMap.values());
  for (const m of months) {
    m.net = m.collectedTotal - m.deductibleTotal;
  }

  // Cumul annuel
  const yearly = {
    collected: {} as Record<string, number>,
    deductible: {} as Record<string, number>,
    collectedTotal: 0,
    deductibleTotal: 0,
    net: 0,
  };
  for (const m of months) {
    for (const [r, v] of Object.entries(m.collected)) {
      yearly.collected[r] = (yearly.collected[r] ?? 0) + v;
    }
    for (const [r, v] of Object.entries(m.deductible)) {
      yearly.deductible[r] = (yearly.deductible[r] ?? 0) + v;
    }
    yearly.collectedTotal += m.collectedTotal;
    yearly.deductibleTotal += m.deductibleTotal;
  }
  yearly.net = yearly.collectedTotal - yearly.deductibleTotal;

  void eq;
  return { months, yearly };
}

/**
 * Liste des taux distincts apparus dans collected ou deductible — pour
 * construire les colonnes du tableau dynamiquement.
 */
export function distinctRates(months: TvaMonth[]): string[] {
  const set = new Set<string>();
  for (const m of months) {
    for (const r of Object.keys(m.collected)) set.add(r);
    for (const r of Object.keys(m.deductible)) set.add(r);
  }
  return [...set].sort((a, b) => Number(b) - Number(a)); // décroissant : 20%, 10%, 5.5%, 2.1%
}
