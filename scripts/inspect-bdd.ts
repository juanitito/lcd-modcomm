import ExcelJS from "exceljs";
import path from "node:path";

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) {
      return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    }
    if ("text" in v) return String((v as { text: string }).text);
    if ("hyperlink" in v) return String((v as { text?: string; hyperlink: string }).text ?? (v as { hyperlink: string }).hyperlink);
    if ("result" in v) return String((v as { result: unknown }).result ?? "");
  }
  return String(v);
}

async function main() {
  const file = path.resolve("data/legacy-excel/BDD.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const bddp = wb.getWorksheet("BDDP")!;
  const header = (bddp.getRow(1).values as unknown[]).map(cellText);
  const idx = (name: string) => header.findIndex((h) => h === name);

  let nb = 0;
  const fournisseurs = new Map<string, number>();
  const familles = new Map<string, number>();
  const falValues = new Map<string, number>();
  const tvaPresent = { yes: 0, no: 0 };

  for (let r = 2; r <= bddp.rowCount; r++) {
    const row = bddp.getRow(r);
    const code = cellText(row.getCell(idx("CODE")).value).trim();
    if (!code) continue;
    nb++;

    const f = cellText(row.getCell(idx("FOURNISSEUR")).value).trim();
    if (f) fournisseurs.set(f, (fournisseurs.get(f) ?? 0) + 1);

    const fam = cellText(row.getCell(idx("FAMILLE PRODUIT")).value).trim();
    if (fam) familles.set(fam, (familles.get(fam) ?? 0) + 1);

    const fal = cellText(row.getCell(idx("FAL")).value).trim();
    falValues.set(fal || "(vide)", (falValues.get(fal || "(vide)") ?? 0) + 1);
  }

  console.log(`BDDP : ${nb} produits réels`);
  console.log(`\nFournisseurs (${fournisseurs.size}):`);
  for (const [k, v] of [...fournisseurs.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(8)} ${v}`);
  }
  console.log(`\nFamilles produit (${familles.size}):`);
  for (const [k, v] of [...familles.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(8)} ${v}`);
  }
  console.log(`\nValeurs FAL :`);
  for (const [k, v] of [...falValues.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${v}`);
  }

  // Échantillon de produits avec FAL = "O" pour deviner le sens
  console.log(`\n5 produits avec FAL=O :`);
  let shown = 0;
  for (let r = 2; r <= bddp.rowCount && shown < 5; r++) {
    const row = bddp.getRow(r);
    const fal = cellText(row.getCell(idx("FAL")).value).trim();
    if (fal === "O") {
      shown++;
      console.log(`  ${cellText(row.getCell(idx("CODE")).value)} - ${cellText(row.getCell(idx("DESIGNATION")).value)}`);
    }
  }
  console.log(`\n5 produits avec FAL=0 :`);
  shown = 0;
  for (let r = 2; r <= bddp.rowCount && shown < 5; r++) {
    const row = bddp.getRow(r);
    const fal = cellText(row.getCell(idx("FAL")).value).trim();
    if (fal === "0") {
      shown++;
      console.log(`  ${cellText(row.getCell(idx("CODE")).value)} - ${cellText(row.getCell(idx("DESIGNATION")).value)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
