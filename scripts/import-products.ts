// Import idempotent du catalogue produits depuis data/legacy-excel/BDD.xlsx (feuille BDDP).
// - Crée à la volée suppliers et product_families inconnus
// - Upsert sur products.code
// - FAL ignorée pour l'instant (presque toujours vide dans le source)
import { config } from "dotenv";
config({ path: ".env.local" });

import ExcelJS from "exceljs";
import path from "node:path";
import { eq } from "drizzle-orm";

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) {
      return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
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

function num(v: unknown): string | null {
  const t = cellText(v).trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n.toString() : null;
}

async function main() {
  const { db, schema } = await import("../lib/db");

  const file = path.resolve("data/legacy-excel/BDD.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const ws = wb.getWorksheet("BDDP");
  if (!ws) throw new Error("Feuille BDDP introuvable");

  const header = (ws.getRow(1).values as unknown[]).map(cellText);
  const idx = (name: string) => {
    const i = header.findIndex((h) => h === name);
    if (i < 0) throw new Error(`colonne ${name} introuvable`);
    return i;
  };

  const C = {
    code: idx("CODE"),
    designation: idx("DESIGNATION"),
    cdt: idx("CONDITIONNEMENT"),
    moq: idx("MOQ"),
    fournisseur: idx("FOURNISSEUR"),
    pa: idx("PA"),
    pdv: idx("PDV"),
    ft: idx("FT"),
    fds: idx("FDS"),
    urlPic: idx("URL PIC"),
    poids: idx("POIDS"),
    volume: idx("VOLUME"),
    famille: idx("FAMILLE PRODUIT"),
  };

  // 1) Précharger / créer suppliers et familles à la volée
  const supplierIdByCode = new Map<string, string>();
  const familyIdByCode = new Map<string, string>();

  async function ensureSupplier(code: string): Promise<string> {
    const cached = supplierIdByCode.get(code);
    if (cached) return cached;
    const found = await db.query.suppliers.findFirst({
      where: eq(schema.suppliers.code, code),
    });
    if (found) {
      supplierIdByCode.set(code, found.id);
      return found.id;
    }
    const [created] = await db
      .insert(schema.suppliers)
      .values({ code, name: code })
      .returning({ id: schema.suppliers.id });
    console.log(`  + supplier créé : ${code}`);
    supplierIdByCode.set(code, created.id);
    return created.id;
  }

  async function ensureFamily(code: string): Promise<string> {
    const cached = familyIdByCode.get(code);
    if (cached) return cached;
    const found = await db.query.productFamilies.findFirst({
      where: eq(schema.productFamilies.code, code),
    });
    if (found) {
      familyIdByCode.set(code, found.id);
      return found.id;
    }
    const [created] = await db
      .insert(schema.productFamilies)
      .values({ code, label: `Famille ${code}` })
      .returning({ id: schema.productFamilies.id });
    console.log(`  + famille créée : ${code}`);
    familyIdByCode.set(code, created.id);
    return created.id;
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const issues: string[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(C.code).value).trim();
    if (!code) {
      skipped++;
      continue;
    }
    const designation = cellText(row.getCell(C.designation).value).trim();
    if (!designation) {
      issues.push(`ligne ${r} : ${code} sans désignation, ignoré`);
      skipped++;
      continue;
    }

    const pa = num(row.getCell(C.pa).value);
    const pdv = num(row.getCell(C.pdv).value);
    if (!pa || !pdv) {
      issues.push(`ligne ${r} : ${code} sans PA ou PDV (PA=${pa}, PDV=${pdv}), ignoré`);
      skipped++;
      continue;
    }

    const fournisseurCode = cellText(row.getCell(C.fournisseur).value).trim();
    const familleCode = cellText(row.getCell(C.famille).value).trim();
    const supplierId = fournisseurCode ? await ensureSupplier(fournisseurCode) : null;
    const familyId = familleCode ? await ensureFamily(familleCode) : null;

    const ft = cellText(row.getCell(C.ft).value).trim();
    const fds = cellText(row.getCell(C.fds).value).trim();
    const urlPic = cellText(row.getCell(C.urlPic).value).trim();

    const values = {
      code,
      designation,
      conditionnement: cellText(row.getCell(C.cdt).value).trim() || null,
      moq: cellText(row.getCell(C.moq).value).trim() || null,
      supplierId,
      familyId,
      purchasePriceHt: pa,
      defaultSalePriceHt: pdv,
      // Source ne contient pas de TVA produit → on garde le défaut 20%
      ftUrl: ft && ft !== "0" ? ft : null,
      fdsUrl: fds && fds !== "0" ? fds : null,
      pictureUrl: urlPic && urlPic !== "0" ? urlPic : null,
      weightKg: num(row.getCell(C.poids).value),
      volumeL: num(row.getCell(C.volume).value),
      updatedAt: new Date(),
    };

    const existing = await db.query.products.findFirst({
      where: eq(schema.products.code, code),
    });
    if (existing) {
      await db
        .update(schema.products)
        .set(values)
        .where(eq(schema.products.id, existing.id));
      updated++;
    } else {
      await db.insert(schema.products).values(values);
      inserted++;
    }
  }

  console.log("\n━━━ Import terminé ━━━");
  console.log(`  ${inserted} produits créés`);
  console.log(`  ${updated} produits mis à jour`);
  console.log(`  ${skipped} lignes ignorées`);
  if (issues.length) {
    console.log("\nProblèmes :");
    for (const i of issues) console.log(`  - ${i}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
