import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/session";
import { computeBilanFormel, type BilanRow } from "@/lib/bilan";

export const runtime = "nodejs";

function addRows(
  ws: ExcelJS.Worksheet,
  startRow: number,
  rows: BilanRow[],
  exYear: number,
): number {
  let row = startRow;
  for (const r of rows) {
    const labelCell = ws.getCell(`A${row}`);
    const indent =
      r.level === 0 ? 0 : r.isSubtotal ? 1 : r.level === 1 ? 1 : 2;
    labelCell.value = `${"  ".repeat(indent)}${r.label}`;
    if (r.isHeader) {
      labelCell.font = { bold: true, size: 11 };
      labelCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
    } else if (r.isGrandTotal) {
      labelCell.font = { bold: true, size: 12 };
      labelCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD1D5DB" },
      };
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

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const exercice = Number.parseInt(
    sp.get("exercice") ?? new Date().getUTCFullYear().toString(),
    10,
  );

  const bilan = await computeBilanFormel(exercice);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LCD Modcomm";
  const ws = wb.addWorksheet(`Pré-bilan ${exercice}`);
  ws.getColumn(1).width = 60;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;

  ws.getCell("A1").value = `PRÉ-BILAN au ${bilan.closingDate} — DOCUMENT NON CERTIFIÉ`;
  ws.getCell("A1").font = { size: 14, bold: true, color: { argb: "FF991B1B" } };
  ws.mergeCells("A1:C1");
  ws.getCell("A2").value = "Lascia Corre Distribution — SAS au capital de 1 000 € — SIRET 422 310 391 00046 — N° TVA FR25925390254";
  ws.mergeCells("A2:C2");
  ws.getCell("A3").value = "Format inspiré du tableau 2050 de la liasse fiscale. À valider par l'expert-comptable.";
  ws.getCell("A3").font = { italic: true, color: { argb: "FF6B7280" } };
  ws.mergeCells("A3:C3");

  // Headers de colonnes
  let row = 5;
  ws.getCell(`A${row}`).value = "Rubrique";
  ws.getCell(`B${row}`).value = `Net ${exercice}`;
  ws.getCell(`C${row}`).value = `Net ${exercice - 1}`;
  [`A${row}`, `B${row}`, `C${row}`].forEach((c) => {
    ws.getCell(c).font = { bold: true };
    ws.getCell(c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
    ws.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
  });
  row++;

  ws.getCell(`A${row}`).value = "ACTIF";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addRows(ws, row, bilan.actif, exercice);
  row += 2;

  ws.getCell(`A${row}`).value = "PASSIF";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addRows(ws, row, bilan.passif, exercice);

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="PreBilan-${exercice}.xlsx"`,
    },
  });
}
