// Liste les transactions Qonto avec attachment, hors qonto_fee (déjà traitées)
// et hors transactions déjà rapprochées dans notre DB.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db, schema } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");

  const txs = await db
    .select()
    .from(schema.qontoTransactions)
    .where(
      sql`(${schema.qontoTransactions.rawJson}->>'operation_type') != 'qonto_fee'
        AND jsonb_array_length(${schema.qontoTransactions.rawJson}->'attachment_ids') > 0`,
    );

  console.log(`${txs.length} transactions hors-fee avec attachment(s)`);
  let credit = 0;
  let debit = 0;
  let alreadyMatched = 0;
  for (const tx of txs) {
    const amt = Number(tx.amount);
    const ids = (tx.rawJson as Record<string, unknown>)?.attachment_ids as
      | string[]
      | undefined;
    const ops = (tx.rawJson as Record<string, unknown>)?.operation_type;
    const matched =
      tx.matchedInvoiceId != null || tx.matchedSupplierInvoiceId != null;
    if (matched) alreadyMatched++;
    if (amt > 0) credit++;
    else debit++;
    console.log(
      `  ${tx.date} | ${amt > 0 ? "+" : ""}${amt}€ | ${tx.counterpartyName ?? tx.label ?? "?"} | op=${ops} | ${ids?.length ?? 0} att | matched=${matched}`,
    );
  }
  console.log(
    `\nCrédits : ${credit} | Débits : ${debit} | Déjà rapprochées : ${alreadyMatched}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
