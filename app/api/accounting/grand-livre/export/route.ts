import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, ilike, lte, or } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, schema } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";

export const runtime = "nodejs";

type Row = {
  date: string;
  entryNumber: string;
  journal: string;
  label: string;
  accountCode: string;
  accountLabel: string;
  debit: number;
  credit: number;
};

async function fetchRows(searchParams: URLSearchParams): Promise<Row[]> {
  const fromDate = searchParams.get("from") ?? "1970-01-01";
  const toDate = searchParams.get("to") ?? "9999-12-31";
  const account = searchParams.get("account") ?? "";
  const q = searchParams.get("q") ?? "";

  const conditions = [
    gte(schema.journalEntries.date, fromDate),
    lte(schema.journalEntries.date, toDate),
  ];
  if (account) conditions.push(eq(schema.journalLines.accountCode, account));
  if (q) {
    conditions.push(
      or(
        ilike(schema.journalLines.label, `%${q}%`),
        ilike(schema.journalEntries.entryNumber, `%${q}%`),
      )!,
    );
  }

  const dbRows = await db
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
    .where(and(...conditions))
    .orderBy(
      asc(schema.journalEntries.date),
      asc(schema.journalEntries.entryNumber),
      asc(schema.journalLines.position),
    );

  const accountLabels = await db.query.chartOfAccounts.findMany({
    columns: { code: true, label: true },
  });
  const labelByCode = new Map(accountLabels.map((a) => [a.code, a.label]));

  return dbRows.map((r) => ({
    date: r.date,
    entryNumber: r.entryNumber,
    journal: r.journal,
    label: r.label,
    accountCode: r.accountCode,
    accountLabel: labelByCode.get(r.accountCode) ?? "",
    debit: Number(r.debit),
    credit: Number(r.credit),
  }));
}

function csvEscape(s: string | number): string {
  const str = String(s);
  return /[,";\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function GET(req: NextRequest) {
  await requireAuth();
  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "csv").toLowerCase();
  const rows = await fetchRows(sp);

  const exercice = sp.get("from")?.slice(0, 4) ?? "tout";
  const account = sp.get("account") ?? "";
  const baseName = account
    ? `GrandLivre-${exercice}-${account}`
    : `GrandLivre-${exercice}`;

  if (format === "csv") {
    const header =
      "Date;Pièce;Journal;Libellé;Compte;Libellé compte;Débit;Crédit";
    const lines = [
      header,
      ...rows.map((r) =>
        [
          r.date,
          r.entryNumber,
          r.journal,
          r.label,
          r.accountCode,
          r.accountLabel,
          r.debit > 0 ? r.debit.toFixed(2).replace(".", ",") : "",
          r.credit > 0 ? r.credit.toFixed(2).replace(".", ",") : "",
        ]
          .map(csvEscape)
          .join(";"),
      ),
    ];
    const body = "﻿" + lines.join("\n"); // BOM pour Excel
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.csv"`,
      },
    });
  }

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "LCD Modcomm";

    if (account) {
      // Vue par compte avec solde cumulé
      const ws = wb.addWorksheet(account);
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
      for (const r of rows) {
        bal += r.debit - r.credit;
        ws.addRow({
          date: r.date,
          entryNumber: r.entryNumber,
          journal: r.journal,
          label: r.label,
          debit: r.debit > 0 ? r.debit : null,
          credit: r.credit > 0 ? r.credit : null,
          balance: bal,
        });
      }
      [5, 6, 7].forEach((c) => {
        ws.getColumn(c).numFmt = "#,##0.00 €";
      });
    } else {
      // Vue consolidée + une feuille par compte
      const consolidated = wb.addWorksheet("Consolidé");
      consolidated.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Pièce", key: "entryNumber", width: 18 },
        { header: "Jrnl", key: "journal", width: 6 },
        { header: "Libellé", key: "label", width: 45 },
        { header: "Compte", key: "accountCode", width: 10 },
        { header: "Libellé compte", key: "accountLabel", width: 30 },
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
          accountLabel: r.accountLabel,
          debit: r.debit > 0 ? r.debit : null,
          credit: r.credit > 0 ? r.credit : null,
        });
      }
      [7, 8].forEach((c) => {
        consolidated.getColumn(c).numFmt = "#,##0.00 €";
      });

      // Une feuille par compte avec solde cumulé
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
          bal += r.debit - r.credit;
          ws.addRow({
            date: r.date,
            entryNumber: r.entryNumber,
            journal: r.journal,
            label: r.label,
            debit: r.debit > 0 ? r.debit : null,
            credit: r.credit > 0 ? r.credit : null,
            balance: bal,
          });
        }
        [5, 6, 7].forEach((c) => {
          ws.getColumn(c).numFmt = "#,##0.00 €";
        });
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "format inconnu" }, { status: 400 });
}
