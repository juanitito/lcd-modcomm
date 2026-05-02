// Re-tente l'extraction sur tous les invoice_imports en status='failed'.
// Utile après l'ajout de la CB sur AI Gateway, ou tout autre déblocage.
// Mirroir de l'action server retryExtraction, sans requireAuth.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq, ilike } = await import("drizzle-orm");
  const { db, schema } = await import("../lib/db");
  const { extractInvoice } = await import("../lib/invoice-extract");

  const failed = await db.query.invoiceImports.findMany({
    where: eq(schema.invoiceImports.status, "failed"),
  });
  console.log(`${failed.length} import(s) en statut 'failed'`);
  if (failed.length === 0) return process.exit(0);

  for (const imp of failed) {
    console.log(`\n→ ${imp.sourceFilename ?? imp.id.slice(0, 8)}`);
    try {
      const res = await fetch(imp.pdfBlobUrl);
      if (!res.ok) throw new Error(`Blob HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      const extracted = await extractInvoice(buf);
      const siret = extracted.clientGuess?.siret?.replace(/\D/g, "");
      let matchedClientId: string | null = null;
      if (siret && siret.length === 14) {
        const c = await db.query.clients.findFirst({
          where: eq(schema.clients.siret, siret),
        });
        if (c) matchedClientId = c.id;
      }
      if (!matchedClientId && extracted.clientGuess?.name) {
        const c = await db.query.clients.findFirst({
          where: ilike(
            schema.clients.name,
            `%${extracted.clientGuess.name.slice(0, 20)}%`,
          ),
        });
        if (c) matchedClientId = c.id;
      }

      await db
        .update(schema.invoiceImports)
        .set({
          extracted,
          matchedClientId,
          errorMessage: null,
          status: matchedClientId ? "extracted" : "needs_review",
          updatedAt: new Date(),
        })
        .where(eq(schema.invoiceImports.id, imp.id));

      console.log(
        `  ✓ ${extracted.legacyNumber ?? "(no number)"} | ${extracted.issueDate ?? "(no date)"} | ${extracted.totals?.totalTtc?.toFixed(2) ?? "?"}€ | client ${matchedClientId ? "matché" : "à matcher manuellement"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.invoiceImports)
        .set({
          status: "failed",
          errorMessage: msg,
          updatedAt: new Date(),
        })
        .where(eq(schema.invoiceImports.id, imp.id));
      console.log(`  ✗ ${msg.slice(0, 200)}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
