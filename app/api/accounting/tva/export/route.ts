import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/session";
import { computeTvaForYear, distinctRates } from "@/lib/tva";

export const runtime = "nodejs";

const CA3_HINTS: Record<string, string> = {
  // Indications approximatives — à confirmer avec le comptable selon le régime
  "20.00":
    "TVA collectée 20% : ligne CA3 08-A (taux normal) ou 09 (Corse art. 297 si applicable)",
  "2.10":
    "TVA collectée 2,1% (Corse) : ligne CA3 spécifique taux Corse art. 297",
  "10.00": "TVA collectée 10% : ligne CA3 09-D",
  "5.50": "TVA collectée 5,5% : ligne CA3 09-B",
};

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const year = Number.parseInt(
    sp.get("exercice") ?? new Date().getUTCFullYear().toString(),
    10,
  );
  const format = (sp.get("format") ?? "xlsx").toLowerCase();

  const { months, yearly } = await computeTvaForYear(year);
  const rates = distinctRates(months);

  if (format === "ca3") {
    return buildCa3HelperResponse(year, months);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "LCD Modcomm";

  // Récap annuel
  const recap = wb.addWorksheet("Récap annuel");
  recap.columns = [
    { header: "Mois", key: "month", width: 18 },
    ...rates.flatMap((r) => [
      { header: `Coll ${r}%`, key: `c${r}`, width: 13 },
    ]),
    { header: "Total coll.", key: "ct", width: 14 },
    ...rates.flatMap((r) => [
      { header: `Déd ${r}%`, key: `d${r}`, width: 13 },
    ]),
    { header: "Total déd.", key: "dt", width: 14 },
    { header: "Net", key: "net", width: 16 },
    { header: "Statut", key: "status", width: 14 },
  ];
  for (const m of months) {
    const row: Record<string, unknown> = {
      month: m.monthLabel,
      ct: m.collectedTotal,
      dt: m.deductibleTotal,
      net: m.net,
      status:
        m.net > 0.01
          ? "À reverser"
          : m.net < -0.01
            ? "Crédit"
            : "—",
    };
    for (const r of rates) {
      row[`c${r}`] = m.collected[r] ?? 0;
      row[`d${r}`] = m.deductible[r] ?? 0;
    }
    recap.addRow(row);
  }
  // Total annuel
  const totalRow: Record<string, unknown> = {
    month: `Total ${year}`,
    ct: yearly.collectedTotal,
    dt: yearly.deductibleTotal,
    net: yearly.net,
    status:
      yearly.net > 0.01
        ? "À reverser"
        : yearly.net < -0.01
          ? "Crédit"
          : "—",
  };
  for (const r of rates) {
    totalRow[`c${r}`] = yearly.collected[r] ?? 0;
    totalRow[`d${r}`] = yearly.deductible[r] ?? 0;
  }
  const t = recap.addRow(totalRow);
  t.font = { bold: true };
  t.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };
  });
  recap.columns.forEach((c, i) => {
    if (i > 0 && c.key !== "status") {
      c.numFmt = "#,##0.00 €";
    }
  });

  // Une feuille par mois (CA3 helper)
  for (const m of months) {
    if (m.collectedTotal === 0 && m.deductibleTotal === 0) continue;
    const ws = wb.addWorksheet(m.monthLabel.replace(/[^A-Za-z0-9 ]/g, ""));
    ws.getCell("A1").value = `Déclaration TVA — ${m.monthLabel}`;
    ws.getCell("A1").font = { size: 14, bold: true };
    ws.mergeCells("A1:D1");

    ws.getCell("A3").value = "TVA COLLECTÉE";
    ws.getCell("A3").font = { bold: true };
    let row = 4;
    for (const r of rates) {
      const v = m.collected[r] ?? 0;
      if (v === 0) continue;
      ws.getCell(`A${row}`).value = `Taux ${r}%`;
      const valCell = ws.getCell(`B${row}`);
      valCell.value = v;
      valCell.numFmt = "#,##0.00 €";
      const hint = CA3_HINTS[r];
      if (hint) {
        valCell.note = hint;
      }
      row++;
    }
    ws.getCell(`A${row}`).value = "Total collectée";
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`B${row}`).value = m.collectedTotal;
    ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
    ws.getCell(`B${row}`).font = { bold: true };
    row += 2;

    ws.getCell(`A${row}`).value = "TVA DÉDUCTIBLE";
    ws.getCell(`A${row}`).font = { bold: true };
    row++;
    for (const r of rates) {
      const v = m.deductible[r] ?? 0;
      if (v === 0) continue;
      ws.getCell(`A${row}`).value = `Taux ${r}% (sur biens et services)`;
      const valCell = ws.getCell(`B${row}`);
      valCell.value = v;
      valCell.numFmt = "#,##0.00 €";
      valCell.note = "TVA déductible : ligne CA3 20 (biens et services)";
      row++;
    }
    ws.getCell(`A${row}`).value = "Total déductible";
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`B${row}`).value = m.deductibleTotal;
    ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
    ws.getCell(`B${row}`).font = { bold: true };
    row += 2;

    ws.getCell(`A${row}`).value = m.net > 0 ? "Net à reverser" : "Crédit de TVA";
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getCell(`A${row}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: m.net > 0 ? "FF991B1B" : "FF065F46" },
    };
    ws.getCell(`B${row}`).value = Math.abs(m.net);
    ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
    ws.getCell(`B${row}`).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getCell(`B${row}`).fill = ws.getCell(`A${row}`).fill;
    ws.getCell(`B${row}`).note =
      m.net > 0
        ? "Ligne CA3 28 — TVA nette à payer"
        : "Ligne CA3 32 — Crédit de TVA reportable";

    ws.getColumn(1).width = 40;
    ws.getColumn(2).width = 16;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="TVA-${year}.xlsx"`,
    },
  });
}

// ============================================================================
// Helper CA3 — fichier d'aide au remplissage du formulaire 3310-CA3-SD
// ============================================================================
//
// Génère un XLSX par exercice avec :
//  - 1 feuille "Récap CA3" : tableau 12 mois × cases CA3 principales (à
//    recopier ligne par ligne sur impots.gouv.fr)
//  - 1 feuille par mois actif, structurée comme le formulaire CA3
//
// Lignes CA3 couvertes pour LCD (mensuel, taux normal 20%, pas d'immo, pas
// d'intracom, pas de Corse) :
//   - Ligne 01 : Ventes, prestations de services (CA HT)
//   - Ligne 08 : Base HT taux normal 20% (= ligne 01 dans notre cas)
//   - Case 8A : TVA collectée 20%
//   - Ligne 16 : Total TVA brute (= 8A pour LCD)
//   - Ligne 20 : TVA déductible biens et services (autres que immobilisations)
//   - Ligne 25 : Total TVA déductible (= ligne 20 pour LCD)
//   - Ligne 28 : TVA nette due (16 − 25), si positive
//   - Ligne 32 : Crédit de TVA (28 − 16), si positif

import type { TvaMonth } from "@/lib/tva";

async function buildCa3HelperResponse(
  year: number,
  months: TvaMonth[],
): Promise<NextResponse> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LCD Modcomm";

  // ---- Feuille 1 : récap exercice ----
  const recap = wb.addWorksheet(`Récap CA3 ${year}`);
  recap.getCell("A1").value = `Aide au remplissage CA3 — Exercice ${year}`;
  recap.getCell("A1").font = { size: 14, bold: true };
  recap.mergeCells("A1:H1");
  recap.getCell("A2").value =
    "Lascia Corre Distribution — SIRET 422 310 391 00046 — N° TVA FR25925390254";
  recap.mergeCells("A2:H2");
  recap.getCell("A3").value =
    "Régime : réel normal mensuel. Régime Corse non appliqué (toutes ventes à 20%).";
  recap.getCell("A3").font = { italic: true, color: { argb: "FF6B7280" } };
  recap.mergeCells("A3:H3");

  recap.getCell("A5").value = "Mois";
  recap.getCell("B5").value = "Ligne 01 — CA HT";
  recap.getCell("C5").value = "Ligne 08 — Base 20%";
  recap.getCell("D5").value = "Case 8A — TVA col. 20%";
  recap.getCell("E5").value = "Ligne 16 — TVA brute";
  recap.getCell("F5").value = "Ligne 20 — TVA déd.";
  recap.getCell("G5").value = "Ligne 25 — Total déd.";
  recap.getCell("H5").value = "Ligne 28/32";
  ["A5", "B5", "C5", "D5", "E5", "F5", "G5", "H5"].forEach((c) => {
    recap.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    recap.getCell(c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
    recap.getCell(c).alignment = { wrapText: true, vertical: "middle" };
  });
  recap.getRow(5).height = 32;

  let row = 6;
  let yearLine01 = 0;
  let yearLine8A = 0;
  let yearLine20 = 0;
  for (const m of months) {
    if (m.collectedTotal === 0 && m.deductibleTotal === 0) continue;
    // Pour LCD : tout est en 20% → ligne 01 = ligne 08 = base HT collectée 20%.
    const base20 = (m.collected["20.00"] ?? 0) / 0.2;
    const tva20 = m.collected["20.00"] ?? 0;
    const ded = m.deductibleTotal;
    const net = m.net;
    recap.getCell(`A${row}`).value = m.monthLabel;
    recap.getCell(`B${row}`).value = base20;
    recap.getCell(`C${row}`).value = base20;
    recap.getCell(`D${row}`).value = tva20;
    recap.getCell(`E${row}`).value = tva20;
    recap.getCell(`F${row}`).value = ded;
    recap.getCell(`G${row}`).value = ded;
    if (net > 0.005) {
      recap.getCell(`H${row}`).value = `Ligne 28 : ${net.toFixed(2)} € à payer`;
      recap.getCell(`H${row}`).font = { color: { argb: "FF991B1B" } };
    } else if (net < -0.005) {
      recap.getCell(`H${row}`).value = `Ligne 32 : ${(-net).toFixed(2)} € de crédit`;
      recap.getCell(`H${row}`).font = { color: { argb: "FF065F46" } };
    } else {
      recap.getCell(`H${row}`).value = "—";
    }
    ["B", "C", "D", "E", "F", "G"].forEach(
      (c) => (recap.getCell(`${c}${row}`).numFmt = "#,##0.00 €"),
    );
    yearLine01 += base20;
    yearLine8A += tva20;
    yearLine20 += ded;
    row++;
  }
  // Total
  recap.getCell(`A${row}`).value = `Total ${year}`;
  recap.getCell(`A${row}`).font = { bold: true };
  recap.getCell(`B${row}`).value = yearLine01;
  recap.getCell(`C${row}`).value = yearLine01;
  recap.getCell(`D${row}`).value = yearLine8A;
  recap.getCell(`E${row}`).value = yearLine8A;
  recap.getCell(`F${row}`).value = yearLine20;
  recap.getCell(`G${row}`).value = yearLine20;
  ["B", "C", "D", "E", "F", "G"].forEach((c) => {
    recap.getCell(`${c}${row}`).numFmt = "#,##0.00 €";
    recap.getCell(`${c}${row}`).font = { bold: true };
  });

  recap.getColumn(1).width = 16;
  for (let i = 2; i <= 7; i++) recap.getColumn(i).width = 16;
  recap.getColumn(8).width = 28;

  // ---- Feuilles par mois actif : structure formulaire CA3 ----
  for (const m of months) {
    if (m.collectedTotal === 0 && m.deductibleTotal === 0) continue;
    const ws = wb.addWorksheet(
      `CA3 ${m.monthLabel}`.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 31),
    );
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 50;
    ws.getColumn(3).width = 18;

    ws.getCell("A1").value = `CA3 ${m.monthLabel} — formulaire 3310-CA3-SD`;
    ws.getCell("A1").font = { size: 14, bold: true };
    ws.mergeCells("A1:C1");
    ws.getCell("A2").value =
      "À recopier dans la déclaration mensuelle sur impots.gouv.fr";
    ws.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
    ws.mergeCells("A2:C2");

    let r = 4;
    const writeBlock = (title: string) => {
      ws.getCell(`A${r}`).value = title;
      ws.getCell(`A${r}`).font = { bold: true, size: 11 };
      ws.getCell(`A${r}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      ws.mergeCells(`A${r}:C${r}`);
      r++;
    };
    const writeLine = (
      code: string,
      label: string,
      value: number | string,
      isMoney = true,
    ) => {
      ws.getCell(`A${r}`).value = code;
      ws.getCell(`A${r}`).font = { name: "Courier New", bold: true };
      ws.getCell(`B${r}`).value = label;
      ws.getCell(`C${r}`).value = value;
      if (isMoney && typeof value === "number") {
        ws.getCell(`C${r}`).numFmt = "#,##0.00 €";
      }
      r++;
    };

    const base20 = (m.collected["20.00"] ?? 0) / 0.2;
    const tva20 = m.collected["20.00"] ?? 0;
    const ded = m.deductibleTotal;
    const net = m.net;

    writeBlock("A — TVA brute (collectée)");
    writeLine("01", "Ventes, prestations de services (CA HT total)", base20);
    writeLine("08", "Base HT taux normal 20%", base20);
    writeLine("8A", "TVA collectée 20% (08 × 20%)", tva20);
    writeLine("16", "TVA brute totale (somme des bases × taux)", tva20);
    r++;
    writeBlock("B — TVA déductible");
    writeLine("19", "TVA sur immobilisations", 0);
    writeLine(
      "20",
      "TVA déductible sur autres biens et services",
      ded,
    );
    writeLine("23", "Reports et autres TVA déductible", 0);
    writeLine("25", "Total TVA déductible (19 + 20 + 23)", ded);
    r++;
    writeBlock("C — TVA à payer / crédit");
    if (net > 0.005) {
      writeLine("28", "TVA nette due (16 − 25)", net);
      ws.getCell(`C${r - 1}`).font = { bold: true, color: { argb: "FF991B1B" } };
      writeLine("32", "Crédit de TVA reportable", 0);
    } else if (net < -0.005) {
      writeLine("28", "TVA nette due (16 − 25)", 0);
      writeLine("32", "Crédit de TVA reportable (25 − 16)", -net);
      ws.getCell(`C${r - 1}`).font = { bold: true, color: { argb: "FF065F46" } };
    } else {
      writeLine("28", "TVA nette due", 0);
      writeLine("32", "Crédit de TVA reportable", 0);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="AideCA3-${year}.xlsx"`,
    },
  });
}
