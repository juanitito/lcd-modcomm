import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/session";
import {
  fetchOpenClientInvoices,
  fetchOpenSupplierInvoices,
  type OpenInvoice,
} from "@/lib/creances-dettes";

export const runtime = "nodejs";

function addRowsToSheet(ws: ExcelJS.Worksheet, rows: OpenInvoice[]) {
  ws.columns = [
    { header: "Date facture", key: "date", width: 14 },
    { header: "N° pièce", key: "number", width: 22 },
    { header: "Tiers", key: "tierName", width: 28 },
    { header: "HT", key: "totalHt", width: 12 },
    { header: "TVA", key: "totalVat", width: 12 },
    { header: "TTC", key: "totalTtc", width: 14 },
    { header: "Échéance", key: "dueDate", width: 14 },
    { header: "Ancienneté (j)", key: "daysOld", width: 14 },
    { header: "Retard (j)", key: "daysOverdue", width: 12 },
  ];
  for (const r of rows) {
    ws.addRow({
      date: r.date,
      number: r.number,
      tierName: r.tierName,
      totalHt: r.totalHt,
      totalVat: r.totalVat,
      totalTtc: r.totalTtc,
      dueDate: r.dueDate ?? "",
      daysOld: r.daysOld,
      daysOverdue: r.daysOverdue ?? "",
    });
  }
  // Total row
  if (rows.length > 0) {
    const totalTtc = rows.reduce((s, r) => s + r.totalTtc, 0);
    const totalHt = rows.reduce((s, r) => s + r.totalHt, 0);
    const totalVat = rows.reduce((s, r) => s + r.totalVat, 0);
    const t = ws.addRow({
      tierName: `Total (${rows.length})`,
      totalHt,
      totalVat,
      totalTtc,
    });
    t.font = { bold: true };
  }
  [4, 5, 6].forEach((c) => (ws.getColumn(c).numFmt = "#,##0.00 €"));
}

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const exercice =
    sp.get("exercice") ?? new Date().getUTCFullYear().toString();
  const closing = sp.get("closing") ?? `${exercice}-12-31`;

  const [creances, dettes] = await Promise.all([
    fetchOpenClientInvoices(closing),
    fetchOpenSupplierInvoices(closing),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LCD Modcomm";

  const wsC = wb.addWorksheet("Créances clients");
  addRowsToSheet(wsC, creances);

  const wsD = wb.addWorksheet("Dettes fournisseurs");
  addRowsToSheet(wsD, dettes);

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="CreancesDettes-${closing.replaceAll("-", "")}.xlsx"`,
    },
  });
}
