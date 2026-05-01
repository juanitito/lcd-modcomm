// Exploration ad hoc du fichier source legacy.
// Liste les feuilles, échantillonne les colonnes, et compte les valeurs distinctes
// des colonnes "intéressantes". Sert à découvrir la structure avant de coder un import.
import ExcelJS from "exceljs";
import path from "node:path";

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) {
      return (v as { richText: { text: string }[] }).richText
        .map((t) => t.text)
        .join("");
    }
    if ("text" in v) return String((v as { text: string }).text);
    if ("hyperlink" in v) {
      const o = v as { text?: string; hyperlink: string };
      return String(o.text ?? o.hyperlink);
    }
    if ("result" in v) return String((v as { result: unknown }).result ?? "");
  }
  return String(v);
}

async function main() {
  const file = path.resolve("data/legacy-excel/BDD.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  console.log(`Feuilles disponibles dans ${path.basename(file)} :`);
  for (const ws of wb.worksheets) {
    console.log(`  - ${ws.name} (${ws.rowCount} lignes, ${ws.columnCount} colonnes)`);
  }

  for (const ws of wb.worksheets) {
    console.log(`\n━━━ ${ws.name} ━━━`);
    const header = (ws.getRow(1).values as unknown[]).map(cellText);
    console.log(`En-têtes : ${header.filter(Boolean).join(" | ")}`);

    // Échantillon des 3 premières lignes de données
    console.log("Échantillon (3 premières lignes) :");
    for (let r = 2; r <= Math.min(4, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const cells = (row.values as unknown[]).map(cellText);
      console.log(`  L${r}: ${cells.slice(1, 8).map((c) => c.slice(0, 30)).join(" | ")}`);
    }
  }

  // Aussi le second fichier 000.004.MODCOMM.xlsx
  const file2 = path.resolve("data/legacy-excel/000.004.MODCOMM.xlsx");
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(file2);

  console.log(`\n\nFeuilles dans ${path.basename(file2)} :`);
  for (const ws of wb2.worksheets) {
    console.log(`  - ${ws.name} (${ws.rowCount} lignes, ${ws.columnCount} colonnes)`);
  }

  for (const ws of wb2.worksheets) {
    console.log(`\n━━━ ${ws.name} ━━━`);
    const header = (ws.getRow(1).values as unknown[]).map(cellText);
    console.log(`En-têtes : ${header.filter(Boolean).join(" | ")}`);
    console.log("Échantillon (3 premières lignes) :");
    for (let r = 2; r <= Math.min(4, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const cells = (row.values as unknown[]).map(cellText);
      console.log(`  L${r}: ${cells.slice(1, 10).map((c) => c.slice(0, 30)).join(" | ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
