// Re-tente le matching contrepartie sur tous les imports en status='needs_review'.
// À lancer après avoir corrigé un fournisseur ou un client (ajout SIRET, rename),
// pour éviter de devoir cliquer "changer" sur chaque carte.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq, ilike } = await import("drizzle-orm");
  const { db, schema } = await import("../lib/db");

  const pending = await db.query.invoiceImports.findMany({
    where: (ii, { eq: e }) => e(ii.status, "needs_review"),
  });

  console.log(`${pending.length} import(s) en needs_review`);
  let matched = 0;

  for (const imp of pending) {
    const ex = imp.extracted;
    if (!ex) continue;
    const siret = ex.clientGuess?.siret?.replace(/\D/g, "");
    const name = ex.clientGuess?.name?.trim();

    let clientId: string | null = null;
    let supplierId: string | null = null;

    if (imp.direction === "client") {
      if (siret && siret.length === 14) {
        const c = await db.query.clients.findFirst({
          where: eq(schema.clients.siret, siret),
        });
        if (c) clientId = c.id;
      }
      if (!clientId && name) {
        const c = await db.query.clients.findFirst({
          where: ilike(schema.clients.name, `%${name.slice(0, 20)}%`),
        });
        if (c) clientId = c.id;
      }
    } else {
      if (siret && siret.length === 14) {
        const s = await db.query.suppliers.findFirst({
          where: eq(schema.suppliers.siret, siret),
        });
        if (s) supplierId = s.id;
      }
      if (!supplierId && name) {
        const s = await db.query.suppliers.findFirst({
          where: ilike(schema.suppliers.name, `%${name.slice(0, 20)}%`),
        });
        if (s) supplierId = s.id;
      }
    }

    const found = clientId || supplierId;
    if (!found) {
      console.log(
        `  - ${imp.sourceFilename ?? imp.id.slice(0, 8)} : pas de match (${name ?? "?"} / siret ${siret ?? "—"})`,
      );
      continue;
    }

    await db
      .update(schema.invoiceImports)
      .set({
        matchedClientId: clientId,
        matchedSupplierId: supplierId,
        status: "extracted",
        updatedAt: new Date(),
      })
      .where(eq(schema.invoiceImports.id, imp.id));
    console.log(
      `  ✓ ${imp.sourceFilename ?? imp.id.slice(0, 8)} → ${imp.direction === "client" ? "client" : "fournisseur"} ${found}`,
    );
    matched++;
  }

  console.log(`\n${matched} sur ${pending.length} matchés.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
