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

  const { months, yearly } = await computeTvaForYear(year);
  const rates = distinctRates(months);

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
