// Helpers compta server-only : seed PCG, période courante, numérotation,
// génération automatique des écritures (issuance + paiement) pour ventes et
// achats. Le registre des kinds + comptes PCG vit dans `accounting-kinds.ts`
// (importable depuis le client).

import { and, eq, gte, like, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PCG_ACCOUNTS } from "@/lib/accounting-kinds";
import supplierAccountMapping from "@/config/supplier-account-mapping.json";
import vatMapping from "@/config/vat-mapping.json";

export {
  CLASSIFICATION_KINDS,
  CLASSIFICATION_KINDS_BY_SIDE,
  type ClassificationKind,
} from "@/lib/accounting-kinds";

type JournalCode = (typeof schema.journalCode.enumValues)[number];

// ============================================================================
// Sous-comptes par tiers : {base}-{code} (ex 411-COPA, 401-CAS)
// ============================================================================

/**
 * Garantit l'existence d'un sous-compte tiers en chart_of_accounts.
 * Crée la ligne `{base}-{tierCode}` si absente.
 */
export async function ensureTierAccount(
  base: string,
  tierCode: string,
  tierName: string,
): Promise<string> {
  const code = `${base}-${tierCode}`;
  const baseDef = PCG_ACCOUNTS[base];
  await db
    .insert(schema.chartOfAccounts)
    .values({
      code,
      label: `${baseDef?.label ?? base} — ${tierName}`,
      parentCode: base,
      classCode: baseDef?.classCode ?? base.slice(0, 1),
      nature: baseDef?.nature ?? "tiers",
    })
    .onConflictDoNothing({ target: schema.chartOfAccounts.code });
  return code;
}

/**
 * Renvoie le compte d'achat à utiliser pour un fournisseur donné.
 * Lookup config/supplier-account-mapping.json par supplier.code.
 */
export function purchaseAccountForSupplier(
  supplierCode: string | null | undefined,
): string {
  const map = supplierAccountMapping as Record<string, string>;
  if (supplierCode && map[supplierCode]) return map[supplierCode];
  return map["_default"] ?? "607";
}

/**
 * Renvoie le compte de TVA collectée correspondant au taux (en pourcentage).
 * 20% → 44571, 2.1% → 44572. Default 44571.
 */
export function vatCollectedAccountForRate(ratePct: number): string {
  if (Math.abs(ratePct - 2.1) < 0.01) return "44572";
  return "44571";
}

/**
 * Override taux TVA par produit (depuis config/vat-mapping.json), sinon
 * fallback au taux du produit lui-même (ou 20% par défaut).
 */
export function vatRateForProduct(
  productCode: string | null | undefined,
  defaultRate: number,
): number {
  const map = vatMapping as Record<string, unknown>;
  if (productCode && typeof map[productCode] === "number") {
    return map[productCode] as number;
  }
  return defaultRate;
}

export async function ensurePcgAccountsExist() {
  for (const [code, a] of Object.entries(PCG_ACCOUNTS)) {
    await db
      .insert(schema.chartOfAccounts)
      .values({ code, ...a })
      .onConflictDoNothing({ target: schema.chartOfAccounts.code });
  }
}

export async function getOrCreatePeriodForDate(
  date: Date,
): Promise<typeof schema.accountingPeriods.$inferSelect> {
  const iso = date.toISOString().slice(0, 10);
  const found = await db.query.accountingPeriods.findFirst({
    where: and(
      lte(schema.accountingPeriods.startDate, iso),
      gte(schema.accountingPeriods.endDate, iso),
    ),
  });
  if (found) return found;

  const year = date.getUTCFullYear();
  const [created] = await db
    .insert(schema.accountingPeriods)
    .values({
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      label: `Exercice ${year}`,
      status: "open",
    })
    .returning();
  return created;
}

export async function nextEntryNumber(
  date: Date,
  journal: JournalCode,
): Promise<string> {
  const year = date.getUTCFullYear();
  const prefix = `${year}-${journal}-`;
  // On prend le max du suffixe numérique (et pas count+1) pour éviter les
  // collisions quand des écritures ont été supprimées dans la séquence
  // (clearMatch laisse des trous, qu'on garde volontairement pour l'audit).
  // MAX calculé côté JS plutôt qu'en SQL — quelques centaines d'écritures
  // max par an, coût négligeable, et ça évite les pièges de templating.
  const rows = await db
    .select({ n: schema.journalEntries.entryNumber })
    .from(schema.journalEntries)
    .where(like(schema.journalEntries.entryNumber, prefix + "%"));
  let maxSuffix = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.n.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxSuffix) maxSuffix = n;
  }
  const next = maxSuffix + 1;
  return `${prefix}${next.toString().padStart(4, "0")}`;
}

export async function deleteJournalEntry(entryId: string) {
  // journalLines ont onDelete:cascade → suppression atomique côté DB.
  await db
    .delete(schema.journalEntries)
    .where(eq(schema.journalEntries.id, entryId));
}

// ============================================================================
// Génération automatique des écritures comptables
// ============================================================================

/**
 * Émission d'une facture client → écriture journal VE.
 * Débit : 411-{client_code} (le client nous doit)
 * Crédit : 707 (Ventes) pour la part HT
 * Crédit : 44571 / 44572 (TVA collectée) ventilée par taux
 */
export async function writeClientInvoiceIssuanceJE(invoiceId: string): Promise<void> {
  const inv = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, invoiceId),
  });
  if (!inv) return;

  const client = await db.query.clients.findFirst({
    where: eq(schema.clients.id, inv.clientId),
  });
  if (!client) return;

  await ensurePcgAccountsExist();
  const tierAccount = await ensureTierAccount("411", client.code, client.name);

  const period = await getOrCreatePeriodForDate(new Date(inv.issueDate));
  const entryNumber = await nextEntryNumber(new Date(inv.issueDate), "VE");
  const label = `Facture ${inv.invoiceNumber} — ${client.name}`;

  const [entry] = await db
    .insert(schema.journalEntries)
    .values({
      periodId: period.id,
      entryNumber,
      date: inv.issueDate,
      journal: "VE",
      label,
      invoiceId: inv.id,
      status: "draft",
    })
    .returning({ id: schema.journalEntries.id });

  const lines: Array<typeof schema.journalLines.$inferInsert> = [];
  // Total TTC au débit du tier
  lines.push({
    entryId: entry.id,
    accountCode: tierAccount,
    label,
    debit: Number(inv.totalTtc).toFixed(2),
    credit: "0.00",
    position: 0,
    matchedInvoiceId: inv.id,
  });
  // HT au crédit de 707 (un seul compte pour les ventes pour l'instant)
  lines.push({
    entryId: entry.id,
    accountCode: "707",
    label,
    debit: "0.00",
    credit: Number(inv.totalHt).toFixed(2),
    position: 1,
  });
  // TVA collectée ventilée par taux
  let pos = 2;
  for (const b of inv.vatBreakdown ?? []) {
    const rate = Number(b.rate);
    const acct = vatCollectedAccountForRate(rate);
    lines.push({
      entryId: entry.id,
      accountCode: acct,
      label: `${label} — TVA ${rate}%`,
      debit: "0.00",
      credit: Number(b.vat).toFixed(2),
      position: pos++,
    });
  }

  await db.insert(schema.journalLines).values(lines);
}

/**
 * Émission d'une facture fournisseur → écriture journal AC.
 * Débit : 60x (compte d'achat selon mapping fournisseur)
 * Débit : 44566 (TVA déductible)
 * Crédit : 401-{supplier_code}
 */
export async function writeSupplierInvoiceIssuanceJE(
  supplierInvoiceId: string,
): Promise<void> {
  const inv = await db.query.supplierInvoices.findFirst({
    where: eq(schema.supplierInvoices.id, supplierInvoiceId),
  });
  if (!inv) return;

  const supplier = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.id, inv.supplierId),
  });
  if (!supplier) return;

  await ensurePcgAccountsExist();
  const tierAccount = await ensureTierAccount("401", supplier.code, supplier.name);
  const purchaseAccount = purchaseAccountForSupplier(supplier.code);

  const period = await getOrCreatePeriodForDate(new Date(inv.issueDate));
  const entryNumber = await nextEntryNumber(new Date(inv.issueDate), "AC");
  const label = `Facture ${inv.supplierInvoiceNumber} — ${supplier.name}`;

  const [entry] = await db
    .insert(schema.journalEntries)
    .values({
      periodId: period.id,
      entryNumber,
      date: inv.issueDate,
      journal: "AC",
      label,
      status: "draft",
    })
    .returning({ id: schema.journalEntries.id });

  const lines: Array<typeof schema.journalLines.$inferInsert> = [];
  lines.push({
    entryId: entry.id,
    accountCode: purchaseAccount,
    label,
    debit: Number(inv.totalHt).toFixed(2),
    credit: "0.00",
    position: 0,
  });
  let pos = 1;
  for (const b of inv.vatBreakdown ?? []) {
    lines.push({
      entryId: entry.id,
      accountCode: "44566",
      label: `${label} — TVA ${b.rate}%`,
      debit: Number(b.vat).toFixed(2),
      credit: "0.00",
      position: pos++,
    });
  }
  // Si pas de ventilation TVA mais une TVA totale, créer une ligne agrégée
  if ((inv.vatBreakdown?.length ?? 0) === 0 && Number(inv.totalVat) > 0) {
    lines.push({
      entryId: entry.id,
      accountCode: "44566",
      label: `${label} — TVA`,
      debit: Number(inv.totalVat).toFixed(2),
      credit: "0.00",
      position: pos++,
    });
  }
  // TTC au crédit du tier
  lines.push({
    entryId: entry.id,
    accountCode: tierAccount,
    label,
    debit: "0.00",
    credit: Number(inv.totalTtc).toFixed(2),
    position: pos++,
    matchedSupplierInvoiceId: inv.id,
  });

  await db.insert(schema.journalLines).values(lines);
}

/**
 * Paiement reçu d'une facture client → écriture journal BQ.
 * Débit : 512 / Crédit : 411-{client_code}
 * Lié à la qonto_transactions via tx.journalEntryId.
 */
export async function writeClientInvoicePaymentJE(
  qontoTxId: string,
  invoiceId: string,
): Promise<string | null> {
  const tx = await db.query.qontoTransactions.findFirst({
    where: eq(schema.qontoTransactions.id, qontoTxId),
  });
  const inv = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, invoiceId),
  });
  if (!tx || !inv) return null;
  const client = await db.query.clients.findFirst({
    where: eq(schema.clients.id, inv.clientId),
  });
  if (!client) return null;

  await ensurePcgAccountsExist();
  const tierAccount = await ensureTierAccount("411", client.code, client.name);

  const txDate = tx.settledAt ?? new Date(tx.date);
  const period = await getOrCreatePeriodForDate(txDate);
  const entryNumber = await nextEntryNumber(txDate, "BQ");
  const label = `Encaissement ${inv.invoiceNumber} — ${client.name}`;
  const amount = Math.abs(Number(tx.amount)).toFixed(2);
  const dateIso = txDate.toISOString().slice(0, 10);

  const [entry] = await db
    .insert(schema.journalEntries)
    .values({
      periodId: period.id,
      entryNumber,
      date: dateIso,
      journal: "BQ",
      label,
      invoiceId: inv.id,
      status: "draft",
    })
    .returning({ id: schema.journalEntries.id });

  await db.insert(schema.journalLines).values([
    {
      entryId: entry.id,
      accountCode: "512",
      label,
      debit: amount,
      credit: "0.00",
      position: 0,
    },
    {
      entryId: entry.id,
      accountCode: tierAccount,
      label,
      debit: "0.00",
      credit: amount,
      position: 1,
      matchedInvoiceId: inv.id,
    },
  ]);

  return entry.id;
}

/**
 * Paiement émis vers un fournisseur → écriture journal BQ.
 * Débit : 401-{supplier_code} / Crédit : 512
 */
export async function writeSupplierInvoicePaymentJE(
  qontoTxId: string,
  supplierInvoiceId: string,
): Promise<string | null> {
  const tx = await db.query.qontoTransactions.findFirst({
    where: eq(schema.qontoTransactions.id, qontoTxId),
  });
  const inv = await db.query.supplierInvoices.findFirst({
    where: eq(schema.supplierInvoices.id, supplierInvoiceId),
  });
  if (!tx || !inv) return null;
  const supplier = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.id, inv.supplierId),
  });
  if (!supplier) return null;

  await ensurePcgAccountsExist();
  const tierAccount = await ensureTierAccount("401", supplier.code, supplier.name);

  const txDate = tx.settledAt ?? new Date(tx.date);
  const period = await getOrCreatePeriodForDate(txDate);
  const entryNumber = await nextEntryNumber(txDate, "BQ");
  const label = `Paiement ${inv.supplierInvoiceNumber} — ${supplier.name}`;
  const amount = Math.abs(Number(tx.amount)).toFixed(2);
  const dateIso = txDate.toISOString().slice(0, 10);

  const [entry] = await db
    .insert(schema.journalEntries)
    .values({
      periodId: period.id,
      entryNumber,
      date: dateIso,
      journal: "BQ",
      label,
      status: "draft",
    })
    .returning({ id: schema.journalEntries.id });

  await db.insert(schema.journalLines).values([
    {
      entryId: entry.id,
      accountCode: tierAccount,
      label,
      debit: amount,
      credit: "0.00",
      position: 0,
      matchedSupplierInvoiceId: inv.id,
    },
    {
      entryId: entry.id,
      accountCode: "512",
      label,
      debit: "0.00",
      credit: amount,
      position: 1,
    },
  ]);

  return entry.id;
}
