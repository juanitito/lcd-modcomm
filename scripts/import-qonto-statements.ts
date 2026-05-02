// Importe les relevés bancaires mensuels Qonto en PDF.
// Idempotent : skip les périodes déjà importées.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq } = await import("drizzle-orm");
  const { put } = await import("@vercel/blob");
  const { db, schema } = await import("../lib/db");
  const { iterateStatements } = await import("../lib/qonto");

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for await (const batch of iterateStatements()) {
    for (const stmt of batch) {
      const existing = await db.query.bankStatements.findFirst({
        where: eq(schema.bankStatements.qontoStatementId, stmt.id),
      });
      if (existing) {
        skipped++;
        continue;
      }
      try {
        const res = await fetch(stmt.file.file_url);
        if (!res.ok) throw new Error(`Téléchargement statement: HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());

        const blobPath = `bank-statements/${stmt.period}-${stmt.file.file_name}`;
        const blob = await put(blobPath, buf, {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: stmt.file.file_content_type,
        });

        await db.insert(schema.bankStatements).values({
          qontoStatementId: stmt.id,
          bankAccountId: stmt.bank_account_id,
          period: stmt.period,
          fileName: stmt.file.file_name,
          fileSize: parseInt(stmt.file.file_size, 10) || buf.length,
          pdfBlobUrl: blob.url,
          pdfBlobPath: blob.pathname,
        });

        console.log(`  ✓ ${stmt.period} (${(buf.length / 1024).toFixed(0)} ko)`);
        imported++;
      } catch (err) {
        console.log(`  ✗ ${stmt.period} : ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }
  }

  console.log(`\n${imported} relevés importés, ${skipped} déjà en base, ${errors} erreurs.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
