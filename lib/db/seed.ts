import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  // import APRÈS chargement de dotenv (sinon db/index.ts throw au load)
  const { db, schema } = await import("./index");
  const { CLIENT_CATEGORIES, VAT_RATES } = await import("./seed-data");

  console.log("Seeding categories de clients…");
  for (const cat of CLIENT_CATEGORIES) {
    await db
      .insert(schema.clientCategories)
      .values({ code: cat.code, label: cat.label })
      .onConflictDoNothing({ target: schema.clientCategories.code });
  }
  console.log(`  ${CLIENT_CATEGORIES.length} catégories OK`);

  console.log("Taux TVA en référence statique (lib/db/seed-data.ts) — pas de table à seed.");
  console.log(`  ${VAT_RATES.length} taux disponibles`);

  console.log("Seed terminé.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
