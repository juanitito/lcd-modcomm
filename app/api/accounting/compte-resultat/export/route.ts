import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/session";
import {
  computeCompteResultatFormel,
  type CompteResultatRow,
} from "@/lib/bilan";

export const runtime = "nodejs";

function addRows(
  ws: ExcelJS.Worksheet,
  startRow: number,
  rows: CompteResultatRow[],
): number {
  let row = startRow;
  for (const r of rows) {
    const indent = r.level === 0 ? 0 : r.isSubtotal ? 1 : 1;
    const labelCell = ws.getCell(`A${row}`);
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

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const exercice = Number.parseInt(
    sp.get("exercice") ?? new Date().getUTCFullYear().toString(),
    10,
  );

  const cr = await computeCompteResultatFormel(exercice);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LCD Modcomm";
  const ws = wb.addWorksheet(`Compte de résultat ${exercice}`);
  ws.getColumn(1).width = 60;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;

  ws.getCell("A1").value = `COMPTE DE RÉSULTAT — Exercice ${exercice}`;
  ws.getCell("A1").font = { size: 14, bold: true };
  ws.mergeCells("A1:C1");
  ws.getCell("A2").value = "Lascia Corre Distribution — SAS au capital de 1 000 € — SIRET 422 310 391 00046";
  ws.mergeCells("A2:C2");
  ws.getCell("A3").value = "Document non certifié — Format inspiré du tableau 2052 de la liasse fiscale.";
  ws.getCell("A3").font = { italic: true, color: { argb: "FF991B1B" } };
  ws.mergeCells("A3:C3");

  let row = 5;
  ws.getCell(`A${row}`).value = "Rubrique";
  ws.getCell(`B${row}`).value = `${exercice}`;
  ws.getCell(`C${row}`).value = `${exercice - 1}`;
  [`A${row}`, `B${row}`, `C${row}`].forEach((c) => {
    ws.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getCell(c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
  });
  row++;

  ws.getCell(`A${row}`).value = "CHARGES";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addRows(ws, row, cr.charges);
  row += 2;

  ws.getCell(`A${row}`).value = "PRODUITS";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  ws.mergeCells(`A${row}:C${row}`);
  row++;
  row = addRows(ws, row, cr.produits);
  row += 2;

  // Soldes intermédiaires
  ws.getCell(`A${row}`).value = "SOLDES INTERMÉDIAIRES";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row++;
  for (const [label, n, n1] of [
    ["Résultat d'exploitation", cr.resultatExploitationN, cr.resultatExploitationN1],
    ["Résultat financier", cr.resultatFinancierN, cr.resultatFinancierN1],
    ["Résultat exceptionnel", cr.resultatExceptionnelN, cr.resultatExceptionnelN1],
  ] as const) {
    ws.getCell(`A${row}`).value = `  ${label}`;
    ws.getCell(`B${row}`).value = n;
    ws.getCell(`C${row}`).value = n1;
    ws.getCell(`B${row}`).numFmt = "#,##0.00 €";
    ws.getCell(`C${row}`).numFmt = "#,##0.00 €";
    row++;
  }
  row++;
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

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="CompteResultat-${exercice}.xlsx"`,
    },
  });
}
