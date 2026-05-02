import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/session";
import { computeBilan, type BilanLine } from "@/lib/bilan";

export const runtime = "nodejs";

function addBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  lines: BilanLine[],
): number {
  let row = startRow;
  ws.getCell(`A${row}`).value = title;
  ws.getCell(`A${row}`).font = { bold: true };
  row++;
  let total = 0;
  for (const l of lines) {
    ws.getCell(`A${row}`).value = `  ${l.label}${l.accountCode ? ` (${l.accountCode})` : ""}`;
    ws.getCell(`B${row}`).value = l.amount;
    ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
    total += l.amount;
    row++;
    if (l.detail) {
      for (const d of l.detail) {
        ws.getCell(`A${row}`).value = `    ${d.code}`;
        ws.getCell(`A${row}`).font = { color: { argb: "FF6B7280" }, italic: true };
        ws.getCell(`B${row}`).value = d.amount;
        ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
        ws.getCell(`B${row}`).font = { color: { argb: "FF6B7280" }, italic: true };
        row++;
      }
    }
  }
  ws.getCell(`A${row}`).value = "Sous-total";
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`B${row}`).value = total;
  ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`B${row}`).font = { bold: true };
  return row + 2;
}

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const exercice =
    sp.get("exercice") ?? new Date().getUTCFullYear().toString();
  const closing = `${exercice}-12-31`;

  const bilan = await computeBilan(closing);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LCD Modcomm";

  const ws = wb.addWorksheet(`Pré-bilan ${exercice}`);
  ws.getColumn(1).width = 50;
  ws.getColumn(2).width = 18;

  ws.getCell("A1").value = `PRÉ-BILAN au ${closing} — DOCUMENT NON CERTIFIÉ`;
  ws.getCell("A1").font = { size: 14, bold: true, color: { argb: "FF991B1B" } };
  ws.mergeCells("A1:B1");

  ws.getCell("A3").value = "Lascia Corre Distribution — SAS au capital de 1 000 €";
  ws.getCell("A4").value = "SIRET 422 310 391 00046 — N° TVA FR25925390254";

  let row = 7;
  ws.getCell(`A${row}`).value = "ACTIF";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;
  row = addBlock(ws, row, "Actif circulant", bilan.actif.circulant);
  row = addBlock(ws, row, "Immobilisations", bilan.actif.immobilisations);
  ws.getCell(`A${row}`).value = "TOTAL ACTIF";
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`B${row}`).value = bilan.actif.total;
  ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`B${row}`).font = { bold: true };
  row += 3;

  ws.getCell(`A${row}`).value = "PASSIF";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;
  row = addBlock(ws, row, "Capitaux propres", bilan.passif.capitauxPropres);
  row = addBlock(ws, row, "Dettes", bilan.passif.dettes);
  ws.getCell(`A${row}`).value = "TOTAL PASSIF";
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`B${row}`).value = bilan.passif.total;
  ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`B${row}`).font = { bold: true };
  row += 2;

  ws.getCell(`A${row}`).value =
    Math.abs(bilan.ecart) < 0.01 ? "✓ Bilan équilibré" : "⚠ Écart Actif - Passif";
  ws.getCell(`B${row}`).value = bilan.ecart;
  ws.getCell(`B${row}`).numFmt = "#,##0.00 €";

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="PreBilan-${exercice}.xlsx"`,
    },
  });
}
