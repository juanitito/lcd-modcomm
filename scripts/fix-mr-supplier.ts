// Met à jour le fournisseur MR avec son SIRET et son vrai nom (extraits par le LLM
// depuis les factures importées). Fait via Drizzle pour passer par le même code path
// que la webapp.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("../lib/db");

  const before = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.code, "MR"),
  });
  if (!before) {
    console.log("Pas de fournisseur MR en DB. Rien à faire.");
    return process.exit(0);
  }
  console.log("Avant :", { code: before.code, name: before.name, siret: before.siret });

  await db
    .update(schema.suppliers)
    .set({
      name: "M.R.Net",
      legalName: "M.R.NET / LE DISTRIBUTEUR DU PROFESSIONNEL",
      siret: "37798160000044",
    })
    .where(eq(schema.suppliers.code, "MR"));

  const after = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.code, "MR"),
  });
  console.log("Après :", { code: after?.code, name: after?.name, siret: after?.siret });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
