// Kit expert-comptable : génère un ZIP complet de l'exercice contenant tous
// les artefacts comptables (grand livre, factures, relevés, états).

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import {
  computeBilanFormel,
  computeCompteResultat,
  computeCompteResultatFormel,
  type BilanRow,
  type CompteResultatRow,
} from "@/lib/bilan";

const COMPANY_SIREN = "925390254";
const JOURNAL_LIB: Record<string, string> = {
  VE: "Ventes",
  AC: "Achats",
  BQ: "Banque",
  CA: "Caisse",
  OD: "Opérations diverses",
};
import {
  fetchOpenClientInvoices,
  fetchOpenSupplierInvoices,
  type OpenInvoice,
} from "@/lib/creances-dettes";
import { computeTvaForYear, distinctRates } from "@/lib/tva";

export const runtime = "nodejs";
// Génération potentiellement longue (téléchargements Blob)
export const maxDuration = 300;

async function fetchPdfBuffer(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

// ----- Builders d'XLSX (réutilisent la même logique que les routes Phase 4-8) -----

async function buildGrandLivreXlsx(year: number): Promise<Buffer> {
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;
  const rows = await db
    .select({
      date: schema.journalEntries.date,
      entryNumber: schema.journalEntries.entryNumber,
      journal: schema.journalEntries.journal,
      label: schema.journalLines.label,
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
    )
    .orderBy(
      asc(schema.journalEntries.date),
      asc(schema.journalEntries.entryNumber),
      asc(schema.journalLines.position),
    );
  const labels = await db.query.chartOfAccounts.findMany({
    columns: { code: true, label: true },
  });
  const labelByCode = new Map(labels.map((l) => [l.code, l.label]));

  const wb = new ExcelJS.Workbook();
  const consolidated = wb.addWorksheet("Consolidé");
  consolidated.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Pièce", key: "entryNumber", width: 18 },
    { header: "Jrnl", key: "journal", width: 6 },
    { header: "Libellé", key: "label", width: 45 },
    { header: "Compte", key: "accountCode", width: 14 },
    { header: "Lib. compte", key: "accountLabel", width: 28 },
    { header: "Débit", key: "debit", width: 12 },
    { header: "Crédit", key: "credit", width: 12 },
  ];
  for (const r of rows) {
    consolidated.addRow({
      date: r.date,
      entryNumber: r.entryNumber,
      journal: r.journal,
      label: r.label,
      accountCode: r.accountCode,
      accountLabel: labelByCode.get(r.accountCode) ?? "",
      debit: Number(r.debit) > 0 ? Number(r.debit) : null,
      credit: Number(r.credit) > 0 ? Number(r.credit) : null,
    });
  }
  [7, 8].forEach((c) => {
    consolidated.getColumn(c).numFmt = "#,##0.00 €";
  });
  // Une feuille par compte
  const accounts = [...new Set(rows.map((r) => r.accountCode))].sort();
  for (const ac of accounts) {
    const ws = wb.addWorksheet(ac.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 31));
    ws.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Pièce", key: "entryNumber", width: 18 },
      { header: "Jrnl", key: "journal", width: 6 },
      { header: "Libellé", key: "label", width: 50 },
      { header: "Débit", key: "debit", width: 12 },
      { header: "Crédit", key: "credit", width: 12 },
      { header: "Solde", key: "balance", width: 14 },
    ];
    let bal = 0;
    for (const r of rows.filter((x) => x.accountCode === ac)) {
      bal += Number(r.debit) - Number(r.credit);
      ws.addRow({
        date: r.date,
        entryNumber: r.entryNumber,
        journal: r.journal,
        label: r.label,
        debit: Number(r.debit) > 0 ? Number(r.debit) : null,
        credit: Number(r.credit) > 0 ? Number(r.credit) : null,
        balance: bal,
      });
    }
    [5, 6, 7].forEach((c) => (ws.getColumn(c).numFmt = "#,##0.00 €"));
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function csvLines(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[,";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(";"), ...rows.map((r) => r.map(escape).join(";"))];
  return "﻿" + lines.join("\n");
}

async function buildGrandLivreCsv(year: number): Promise<string> {
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;
  const rows = await db
    .select({
      date: schema.journalEntries.date,
      entryNumber: schema.journalEntries.entryNumber,
      journal: schema.journalEntries.journal,
      label: schema.journalLines.label,
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
    )
    .orderBy(asc(schema.journalEntries.date));
  return csvLines(
    ["Date", "Pièce", "Journal", "Libellé", "Compte", "Débit", "Crédit"],
    rows.map((r) => [
      r.date,
      r.entryNumber,
      r.journal,
      r.label,
      r.accountCode,
      Number(r.debit) > 0 ? Number(r.debit).toFixed(2).replace(".", ",") : "",
      Number(r.credit) > 0 ? Number(r.credit).toFixed(2).replace(".", ",") : "",
    ]),
  );
}

async function buildCreancesDettesXlsx(closing: string): Promise<Buffer> {
  const [creances, dettes] = await Promise.all([
    fetchOpenClientInvoices(closing),
    fetchOpenSupplierInvoices(closing),
  ]);
  const wb = new ExcelJS.Workbook();
  const addRows = (ws: ExcelJS.Worksheet, rows: OpenInvoice[]) => {
    ws.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "N° pièce", key: "number", width: 22 },
      { header: "Tiers", key: "tierName", width: 28 },
      { header: "HT", key: "totalHt", width: 12 },
      { header: "TVA", key: "totalVat", width: 12 },
      { header: "TTC", key: "totalTtc", width: 14 },
      { header: "Échéance", key: "dueDate", width: 14 },
      { header: "Anc. (j)", key: "daysOld", width: 10 },
      { header: "Retard (j)", key: "daysOverdue", width: 12 },
    ];
    for (const r of rows) ws.addRow({
      ...r,
      dueDate: r.dueDate ?? "",
      daysOverdue: r.daysOverdue ?? "",
    });
    [4, 5, 6].forEach((c) => (ws.getColumn(c).numFmt = "#,##0.00 €"));
  };
  addRows(wb.addWorksheet("Créances clients"), creances);
  addRows(wb.addWorksheet("Dettes fournisseurs"), dettes);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function addBilanRows(
  ws: ExcelJS.Worksheet,
  startRow: number,
  rows: BilanRow[],
): number {
  let row = startRow;
  for (const r of rows) {
    const indent = r.level === 0 ? 0 : 1;
    const labelCell = ws.getCell(`A${row}`);
    labelCell.value = `${"  ".repeat(indent)}${r.label}`;
    if (r.isHeader) {
      labelCell.font = { bold: true, size: 11 };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    } else if (r.isGrandTotal) {
      labelCell.font = { bold: true, size: 12 };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };
    } else if (r.isSubtotal) {
      labelCell.font = { bold: true };
    }
    if (!r.isHeader) {
      const nCell = ws.getCell(`B${row}`);
      const n1Cell = ws.getCell(`C${row}`);
      nCell.value = r.netN;
      n1Cell.value = r.netN1;
      nCell.numFmt = "#,##0.00 €";
      n1Cell.numFmt = "#,##0.00 €";
      if (r.isGrandTotal) {
        nCell.font = { bold: true, size: 12 };
        n1Cell.font = { bold: true, size: 12 };
        nCell.fill = labelCell.fill;
        n1Cell.fill = labelCell.fill;
      } else if (r.isSubtotal) {
        nCell.font = { bold: true };
        n1Cell.font = { bold: true };
      }
    }
    row++;
  }
  return row;
}

async function buildPreBilanXlsx(closing: string): Promise<Buffer> {
  const exercice = Number.parseInt(closing.slice(0, 4), 10);
  const bilan = await computeBilanFormel(exercice);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Pré-bilan ${exercice}`);
  ws.getColumn(1).width = 60;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;
  ws.getCell("A1").value = `PRÉ-BILAN au ${closing} — DOCUMENT NON CERTIFIÉ`;
  ws.getCell("A1").font = { size: 14, bold: true, color: { argb: "FF991B1B" } };
  ws.mergeCells("A1:C1");
  ws.getCell("A2").value = "Lascia Corre Distribution — SAS au capital de 1 000 € — SIRET 422 310 391 00046";
  ws.mergeCells("A2:C2");
  let row = 4;
  ws.getCell(`A${row}`).value = "Rubrique";
  ws.getCell(`B${row}`).value = `${exercice}`;
  ws.getCell(`C${row}`).value = `${exercice - 1}`;
  [`A${row}`, `B${row}`, `C${row}`].forEach((c) => {
    ws.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  });
  row++;
  ws.getCell(`A${row}`).value = "ACTIF";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addBilanRows(ws, row, bilan.actif);
  row += 2;
  ws.getCell(`A${row}`).value = "PASSIF";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addBilanRows(ws, row, bilan.passif);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function addCRRows(
  ws: ExcelJS.Worksheet,
  startRow: number,
  rows: CompteResultatRow[],
): number {
  let row = startRow;
  for (const r of rows) {
    const indent = r.level === 0 ? 0 : 1;
    const labelCell = ws.getCell(`A${row}`);
    labelCell.value = `${"  ".repeat(indent)}${r.label}`;
    if (r.isHeader) {
      labelCell.font = { bold: true, size: 11 };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    } else if (r.isGrandTotal) {
      labelCell.font = { bold: true, size: 12 };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };
    } else if (r.isSubtotal) {
      labelCell.font = { bold: true };
    }
    if (!r.isHeader) {
      const nCell = ws.getCell(`B${row}`);
      const n1Cell = ws.getCell(`C${row}`);
      nCell.value = r.amountN;
      n1Cell.value = r.amountN1;
      nCell.numFmt = "#,##0.00 €";
      n1Cell.numFmt = "#,##0.00 €";
      if (r.isGrandTotal) {
        nCell.font = { bold: true, size: 12 };
        n1Cell.font = { bold: true, size: 12 };
        nCell.fill = labelCell.fill;
        n1Cell.fill = labelCell.fill;
      } else if (r.isSubtotal) {
        nCell.font = { bold: true };
        n1Cell.font = { bold: true };
      }
    }
    row++;
  }
  return row;
}

async function buildCompteResultatXlsx(year: number): Promise<Buffer> {
  const cr = await computeCompteResultatFormel(year);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compte de résultat");
  ws.getColumn(1).width = 60;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;
  ws.getCell("A1").value = `COMPTE DE RÉSULTAT — Exercice ${year} — DOCUMENT NON CERTIFIÉ`;
  ws.getCell("A1").font = { size: 14, bold: true, color: { argb: "FF991B1B" } };
  ws.mergeCells("A1:C1");
  ws.getCell("A2").value = "Lascia Corre Distribution — SAS au capital de 1 000 € — SIRET 422 310 391 00046";
  ws.mergeCells("A2:C2");
  let row = 4;
  ws.getCell(`A${row}`).value = "Rubrique";
  ws.getCell(`B${row}`).value = `${year}`;
  ws.getCell(`C${row}`).value = `${year - 1}`;
  [`A${row}`, `B${row}`, `C${row}`].forEach((c) => {
    ws.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  });
  row++;
  ws.getCell(`A${row}`).value = "CHARGES";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addCRRows(ws, row, cr.charges);
  row += 2;
  ws.getCell(`A${row}`).value = "PRODUITS";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addCRRows(ws, row, cr.produits);
  row += 2;
  ws.getCell(`A${row}`).value = cr.resultatNetN >= 0 ? "RÉSULTAT NET (BÉNÉFICE)" : "RÉSULTAT NET (PERTE)";
  ws.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  ws.getCell(`A${row}`).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: cr.resultatNetN >= 0 ? "FF065F46" : "FF991B1B" },
  };
  ws.getCell(`B${row}`).value = cr.resultatNetN;
  ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`B${row}`).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  ws.getCell(`B${row}`).fill = ws.getCell(`A${row}`).fill;
  ws.getCell(`C${row}`).value = cr.resultatNetN1;
  ws.getCell(`C${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`C${row}`).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell(`C${row}`).fill = ws.getCell(`A${row}`).fill;
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function buildFec(year: number): Promise<string> {
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;
  const rows = await db
    .select({
      date: schema.journalEntries.date,
      entryNumber: schema.journalEntries.entryNumber,
      journal: schema.journalEntries.journal,
      label: schema.journalLines.label,
      accountCode: schema.journalLines.accountCode,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      eq(schema.journalLines.entryId, schema.journalEntries.id),
    )
    .where(and(gte(schema.journalEntries.date, fromDate), lte(schema.journalEntries.date, toDate)))
    .orderBy(asc(schema.journalEntries.date), asc(schema.journalLines.position));

  const accounts = await db.query.chartOfAccounts.findMany({
    columns: { code: true, label: true },
  });
  const labelByCode = new Map(accounts.map((a) => [a.code, a.label]));

  const header = [
    "JournalCode", "JournalLib", "EcritureNum", "EcritureDate",
    "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib",
    "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit",
    "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise",
  ].join("|");
  const lines = [header];
  for (const r of rows) {
    const isAux = /^\d{2,3}-/.test(r.accountCode);
    const compteNum = isAux ? r.accountCode.split("-")[0] : r.accountCode;
    const compAuxNum = isAux ? r.accountCode.split("-").slice(1).join("-") : "";
    const dateCompact = r.date.replaceAll("-", "");
    const cells = [
      r.journal,
      JOURNAL_LIB[r.journal] ?? r.journal,
      r.entryNumber,
      dateCompact,
      compteNum,
      labelByCode.get(r.accountCode) ?? compteNum,
      compAuxNum,
      compAuxNum && labelByCode.get(r.accountCode) ? labelByCode.get(r.accountCode)! : "",
      r.entryNumber,
      dateCompact,
      r.label,
      Number(r.debit) > 0 ? Number(r.debit).toFixed(2).replace(".", ",") : "0,00",
      Number(r.credit) > 0 ? Number(r.credit).toFixed(2).replace(".", ",") : "0,00",
      "",
      "",
      dateCompact,
      "",
      "",
    ].map((s) => String(s).replace(/[|\r\n]/g, " ").trim());
    lines.push(cells.join("|"));
  }
  return "﻿" + lines.join("\r\n");
}

async function buildTvaXlsx(year: number): Promise<Buffer> {
  const { months, yearly } = await computeTvaForYear(year);
  const rates = distinctRates(months);
  const wb = new ExcelJS.Workbook();
  const recap = wb.addWorksheet("Récap");
  recap.columns = [
    { header: "Mois", key: "m", width: 18 },
    ...rates.map((r) => ({ header: `Coll ${r}%`, key: `c${r}`, width: 12 })),
    { header: "Total coll.", key: "ct", width: 14 },
    ...rates.map((r) => ({ header: `Déd ${r}%`, key: `d${r}`, width: 12 })),
    { header: "Total déd.", key: "dt", width: 14 },
    { header: "Net", key: "net", width: 14 },
  ];
  for (const m of months) {
    const row: Record<string, unknown> = {
      m: m.monthLabel,
      ct: m.collectedTotal,
      dt: m.deductibleTotal,
      net: m.net,
    };
    for (const r of rates) {
      row[`c${r}`] = m.collected[r] ?? 0;
      row[`d${r}`] = m.deductible[r] ?? 0;
    }
    recap.addRow(row);
  }
  recap.addRow({
    m: `Total ${year}`,
    ct: yearly.collectedTotal,
    dt: yearly.deductibleTotal,
    net: yearly.net,
    ...Object.fromEntries(
      rates.flatMap((r) => [
        [`c${r}`, yearly.collected[r] ?? 0],
        [`d${r}`, yearly.deductible[r] ?? 0],
      ]),
    ),
  });
  recap.columns.forEach((c, i) => {
    if (i > 0) c.numFmt = "#,##0.00 €";
  });
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ----- Build the README.txt -----

async function buildReadme(year: number): Promise<string> {
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;

  const allInvoices = await db.query.invoices.findMany({
    where: and(
      gte(schema.invoices.issueDate, fromDate),
      lte(schema.invoices.issueDate, toDate),
    ),
  });
  const allSupplierInvoices = await db.query.supplierInvoices.findMany({
    where: and(
      gte(schema.supplierInvoices.issueDate, fromDate),
      lte(schema.supplierInvoices.issueDate, toDate),
    ),
  });
  const totalSalesHt = allInvoices.reduce((s, i) => s + Number(i.totalHt), 0);
  const totalPurchasesHt = allSupplierInvoices.reduce(
    (s, i) => s + Number(i.totalHt),
    0,
  );

  const closing = `${year}-12-31`;
  const bilan = await computeBilanFormel(year);
  const cr = await computeCompteResultat(fromDate, closing);
  const { yearly: tva } = await computeTvaForYear(year);
  const creances = await fetchOpenClientInvoices(closing);
  const dettes = await fetchOpenSupplierInvoices(closing);

  const tresorerie =
    bilan.actif.find((r) => r.accountHint === "512, 53")?.netN ?? 0;

  const today = new Date();
  const today_fr = `${today.getDate().toString().padStart(2, "0")}/${(today.getMonth() + 1).toString().padStart(2, "0")}/${today.getFullYear()}`;

  return `Dossier comptable Lascia Corre Distribution — Exercice ${year}
SAS au capital de 1 000 € — SIRET 422 310 391 00046
N° TVA : FR25925390254
------------------------------------------------------------
Période : 01/01/${year} – 31/12/${year}
Généré le : ${today_fr}

Factures de vente  : ${allInvoices.length}  (total HT : ${totalSalesHt.toFixed(2).replace(".", ",")} €)
Factures d'achat   : ${allSupplierInvoices.length}  (total HT : ${totalPurchasesHt.toFixed(2).replace(".", ",")} €)
Solde bancaire au 31/12 : ${tresorerie.toFixed(2).replace(".", ",")} €
Créances ouvertes  : ${creances.length} factures — ${creances.reduce((s, r) => s + r.totalTtc, 0).toFixed(2).replace(".", ",")} € TTC
Dettes ouvertes    : ${dettes.length} factures — ${dettes.reduce((s, r) => s + r.totalTtc, 0).toFixed(2).replace(".", ",")} € TTC
Résultat net       : ${cr.resultat.toFixed(2).replace(".", ",")} € (${cr.resultat >= 0 ? "bénéfice" : "perte"})

TVA :
  Collectée totale : ${tva.collectedTotal.toFixed(2).replace(".", ",")} €
  Déductible totale: ${tva.deductibleTotal.toFixed(2).replace(".", ",")} €
  Net à reverser   : ${tva.net.toFixed(2).replace(".", ",")} €
  Statut           : [À COMPLÉTER — reversée / non reversée / en cours]

Particularités :
- Pas d'immobilisations
- Pas de charges exceptionnelles connues
- Pas de salariés
- Lettrage : exhaustif via module Banque (API Qonto)
- Pré-bilan et compte de résultat NON CERTIFIÉS — à valider avant dépôt

Contenu du ZIP :
  1-Grand-Livre/         écritures complètes (CSV + XLSX + FEC légal)
  2-Factures-Vente/      PDFs des factures clients
  3-Factures-Achat/      PDFs des factures fournisseurs
  4-Releves-Bancaires/   relevés mensuels Qonto
  5-Creances-Dettes/     état au 31/12 (XLSX)
  6-Pre-Bilan/           bilan formel actif/passif au 31/12, N vs N-1 (XLSX)
  7-Compte-Resultat/     charges/produits formels, N vs N-1 (XLSX)
  8-TVA/                 ventilation par mois × taux (XLSX)
`;
}

// ----- Route principale -----

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const year = Number.parseInt(
    sp.get("exercice") ?? new Date().getUTCFullYear().toString(),
    10,
  );
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;
  const closing = toDate;

  const zip = new JSZip();

  // 1. Grand livre — CSV + XLSX + FEC légal
  const gl1 = zip.folder("1-Grand-Livre")!;
  gl1.file(`GL-${year}-complet.csv`, await buildGrandLivreCsv(year));
  gl1.file(
    `${COMPANY_SIREN}FEC${year}1231.txt`,
    await buildFec(year),
  );
  gl1.file(`GL-${year}-complet.xlsx`, await buildGrandLivreXlsx(year));

  // 2. Factures vente
  const f2 = zip.folder("2-Factures-Vente")!;
  const allInv = await db.query.invoices.findMany({
    where: and(
      gte(schema.invoices.issueDate, fromDate),
      lte(schema.invoices.issueDate, toDate),
    ),
  });
  for (const inv of allInv) {
    if (!inv.pdfBlobUrl) continue;
    const buf = await fetchPdfBuffer(inv.pdfBlobUrl);
    if (!buf) continue;
    const filename = inv.pdfBlobPath?.split("/").pop() ?? `${inv.invoiceNumber}.pdf`;
    f2.file(filename, buf);
  }

  // 3. Factures achat
  const f3 = zip.folder("3-Factures-Achat")!;
  const allSI = await db.query.supplierInvoices.findMany({
    where: and(
      gte(schema.supplierInvoices.issueDate, fromDate),
      lte(schema.supplierInvoices.issueDate, toDate),
    ),
  });
  for (const inv of allSI) {
    if (!inv.pdfBlobUrl) continue;
    const buf = await fetchPdfBuffer(inv.pdfBlobUrl);
    if (!buf) continue;
    const filename = inv.pdfBlobPath?.split("/").pop() ?? `${inv.supplierInvoiceNumber}.pdf`;
    f3.file(filename, buf);
  }

  // 4. Relevés bancaires
  const f4 = zip.folder("4-Releves-Bancaires")!;
  const statements = await db.query.bankStatements.findMany();
  const yearStmts = statements.filter((s) => s.period.endsWith(year.toString()));
  for (const s of yearStmts) {
    const buf = await fetchPdfBuffer(s.pdfBlobUrl);
    if (!buf) continue;
    const filename = s.fileName ?? s.pdfBlobPath.split("/").pop() ?? `Qonto-${s.period}.pdf`;
    f4.file(filename, buf);
  }

  // 5. Créances/dettes
  const f5 = zip.folder("5-Creances-Dettes")!;
  f5.file(
    `CreancesDettes-au-3112${year}.xlsx`,
    await buildCreancesDettesXlsx(closing),
  );

  // 6. Pré-bilan
  const f6 = zip.folder("6-Pre-Bilan")!;
  f6.file(`PreBilan-${year}.xlsx`, await buildPreBilanXlsx(closing));

  // 7. Compte de résultat
  const f7 = zip.folder("7-Compte-Resultat")!;
  f7.file(
    `CompteResultat-${year}.xlsx`,
    await buildCompteResultatXlsx(year),
  );

  // 8. TVA (bonus, non explicit dans le brief mais utile)
  const f8 = zip.folder("8-TVA")!;
  f8.file(`TVA-${year}.xlsx`, await buildTvaXlsx(year));

  // README
  zip.file("README.txt", await buildReadme(year));

  const buf = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(buf as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="LCD-Comptabilite-${year}.zip"`,
    },
  });
}
