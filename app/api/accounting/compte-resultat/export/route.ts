import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/session";
import { computeCompteResultat } from "@/lib/bilan";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const exercice =
    sp.get("exercice") ?? new Date().getUTCFullYear().toString();
  const fromDate = `${exercice}-01-01`;
  const toDate = `${exercice}-12-31`;

  const cr = await computeCompteResultat(fromDate, toDate);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LCD Modcomm";
  const ws = wb.addWorksheet(`Compte de résultat ${exercice}`);
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 50;
  ws.getColumn(3).width = 16;

  ws.getCell("A1").value = `COMPTE DE RÉSULTAT — Exercice ${exercice}`;
  ws.getCell("A1").font = { size: 14, bold: true };
  ws.mergeCells("A1:C1");
  ws.getCell("A2").value = "Document non certifié — à valider par l'expert-comptable";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF991B1B" } };
  ws.mergeCells("A2:C2");

  let row = 4;
  ws.getCell(`A${row}`).value = "CHARGES";
  ws.getCell(`A${row}`).font = { bold: true };
  row++;
  ws.getCell(`A${row}`).value = "Compte";
  ws.getCell(`B${row}`).value = "Libellé";
  ws.getCell(`C${row}`).value = "Montant";
  [`A${row}`, `B${row}`, `C${row}`].forEach((c) => {
    ws.getCell(c).font = { bold: true, color: { argb: "FF6B7280" } };
  });
  row++;
  for (const l of cr.chargesLines) {
    ws.getCell(`A${row}`).value = l.accountCode;
    ws.getCell(`A${row}`).font = { name: "Courier New" };
    ws.getCell(`B${row}`).value = l.label;
    ws.getCell(`C${row}`).value = l.amount;
    ws.getCell(`C${row}`).numFmt = "#,##0.00 €";
    row++;
  }
  ws.getCell(`B${row}`).value = "Total charges";
  ws.getCell(`B${row}`).font = { bold: true };
  ws.getCell(`C${row}`).value = cr.charges;
  ws.getCell(`C${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`C${row}`).font = { bold: true };
  row += 3;

  ws.getCell(`A${row}`).value = "PRODUITS";
  ws.getCell(`A${row}`).font = { bold: true };
  row++;
  ws.getCell(`A${row}`).value = "Compte";
  ws.getCell(`B${row}`).value = "Libellé";
  ws.getCell(`C${row}`).value = "Montant";
  [`A${row}`, `B${row}`, `C${row}`].forEach((c) => {
    ws.getCell(c).font = { bold: true, color: { argb: "FF6B7280" } };
  });
  row++;
  for (const l of cr.produitsLines) {
    ws.getCell(`A${row}`).value = l.accountCode;
    ws.getCell(`A${row}`).font = { name: "Courier New" };
    ws.getCell(`B${row}`).value = l.label;
    ws.getCell(`C${row}`).value = l.amount;
    ws.getCell(`C${row}`).numFmt = "#,##0.00 €";
    row++;
  }
  ws.getCell(`B${row}`).value = "Total produits";
  ws.getCell(`B${row}`).font = { bold: true };
  ws.getCell(`C${row}`).value = cr.produits;
  ws.getCell(`C${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`C${row}`).font = { bold: true };
  row += 3;

  ws.getCell(`B${row}`).value =
    cr.resultat > 0 ? "RÉSULTAT NET (bénéfice)" : "RÉSULTAT NET (perte)";
  ws.getCell(`B${row}`).font = { bold: true, size: 12 };
  ws.getCell(`B${row}`).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: cr.resultat >= 0 ? "FFD1FAE5" : "FFFEE2E2" },
  };
  ws.getCell(`C${row}`).value = cr.resultat;
  ws.getCell(`C${row}`).numFmt = "#,##0.00 €";
  ws.getCell(`C${row}`).font = { bold: true, size: 12 };
  ws.getCell(`C${row}`).fill = ws.getCell(`B${row}`).fill;

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="CompteResultat-${exercice}.xlsx"`,
    },
  });
}
