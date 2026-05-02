import {
  pgTable,
  uuid,
  text,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// =====================================================================
// ENUMS
// =====================================================================

export const orderStatus = pgEnum("order_status", [
  "draft",
  "quoted",
  "confirmed",
  "delivered",
  "invoiced",
  "cancelled",
]);

export const invoiceType = pgEnum("invoice_type", [
  "invoice",
  "credit_note",
  "proforma",
]);

export const invoiceStatus = pgEnum("invoice_status", [
  "issued",
  "paid",
  "partial",
  "overdue",
  "cancelled",
]);

export const journalCode = pgEnum("journal_code", [
  "VE", // Ventes
  "AC", // Achats
  "BQ", // Banque
  "CA", // Caisse
  "OD", // Opérations Diverses
]);

export const journalEntryStatus = pgEnum("journal_entry_status", [
  "draft",
  "validated",
]);

export const invoiceDirection = pgEnum("invoice_direction", [
  "client",   // facture émise par nous au client (créance)
  "supplier", // facture reçue d'un fournisseur (dette)
]);

// =====================================================================
// REFERENCES
// =====================================================================

// Catégories purement descriptives. La marge n'est PAS bindée à la catégorie
// (pratique variable) — elle vit sur le client et sur la ligne de commande.
export const clientCategories = pgTable("client_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  label: text("label").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productFamilies = pgTable("product_families", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  label: text("label").notNull(),
});

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 16 }).notNull().unique(), // ex "MR"
  name: text("name").notNull(),
  legalName: text("legal_name"),
  siret: varchar("siret", { length: 14 }),
  vatNumber: varchar("vat_number", { length: 32 }),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  customerAccountNumber: text("customer_account_number"), // notre n° de compte chez eux
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =====================================================================
// CATALOGUE PRODUITS
// =====================================================================

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 32 }).notNull().unique(), // ex "00JT84"
    designation: text("designation").notNull(),
    conditionnement: text("conditionnement"),
    moq: text("moq"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    familyId: uuid("family_id").references(() => productFamilies.id),
    purchasePriceHt: numeric("purchase_price_ht", { precision: 12, scale: 4 }).notNull(),
    defaultSalePriceHt: numeric("default_sale_price_ht", { precision: 12, scale: 4 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("20.00"),
    ftUrl: text("ft_url"),
    fdsUrl: text("fds_url"),
    pictureUrl: text("picture_url"),
    weightKg: numeric("weight_kg", { precision: 10, scale: 3 }),
    volumeL: numeric("volume_l", { precision: 10, scale: 3 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_designation_idx").on(t.designation)],
);

// =====================================================================
// CLIENTS
// =====================================================================

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 16 }).notNull().unique(), // ex "0001"
    name: text("name").notNull(), // nom commercial
    legalName: text("legal_name"), // raison sociale
    siret: varchar("siret", { length: 14 }),
    vatNumber: varchar("vat_number", { length: 32 }),
    iban: varchar("iban", { length: 34 }),

    billingAddress: text("billing_address"),
    billingCity: text("billing_city"),
    billingZip: varchar("billing_zip", { length: 16 }),

    shippingAddress: text("shipping_address"),
    shippingCity: text("shipping_city"),
    shippingZip: varchar("shipping_zip", { length: 16 }),

    geoZone: varchar("geo_zone", { length: 32 }), // ZG : BONIF, PVN, Aja…
    categoryId: uuid("category_id").references(() => clientCategories.id),
    // Marge cible historique pour ce client (préférence personnelle, modifiable à chaque commande)
    defaultMarginPct: numeric("default_margin_pct", { precision: 5, scale: 2 }),
    paymentTerms: text("payment_terms").default("à réception"),

    contacts: jsonb("contacts").$type<Array<{
      name?: string;
      role?: string;
      phone?: string;
      email?: string;
    }>>().notNull().default(sql`'[]'::jsonb`),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("clients_siret_idx").on(t.siret)],
);

// Tarifs négociés par client/produit (la valeur ajoutée vs Excel)
export const clientProductPrices = pgTable(
  "client_product_prices",
  {
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    salePriceHt: numeric("sale_price_ht", { precision: 12, scale: 4 }).notNull(),
    marginPct: numeric("margin_pct", { precision: 5, scale: 2 }), // calculé ou saisi
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.productId] })],
);

// =====================================================================
// COMMANDES (cycle commercial)
// =====================================================================

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: varchar("order_number", { length: 32 }).notNull().unique(), // ex "2026-0042"
    clientId: uuid("client_id").notNull().references(() => clients.id),
    status: orderStatus("status").notNull().default("draft"),

    dateCreated: date("date_created").notNull().defaultNow(),
    dateDeliveryPlanned: date("date_delivery_planned"),

    shippingAddressOverride: text("shipping_address_override"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("orders_client_idx").on(t.clientId)],
);

export const orderLines = pgTable("order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id),

  // snapshots pour figer la commande même si le produit change ensuite
  codeSnapshot: varchar("code_snapshot", { length: 32 }).notNull(),
  designationSnapshot: text("designation_snapshot").notNull(),
  conditionnementSnapshot: text("conditionnement_snapshot"),

  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  purchasePriceHt: numeric("purchase_price_ht", { precision: 12, scale: 4 }).notNull(),
  salePriceHt: numeric("sale_price_ht", { precision: 12, scale: 4 }).notNull(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
  lineTotalHt: numeric("line_total_ht", { precision: 14, scale: 2 }).notNull(),

  position: integer("position").notNull().default(0),
});

// =====================================================================
// FACTURES (entité légale immuable)
// =====================================================================

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // numérotation séquentielle légale (ininterrompue)
    invoiceNumber: varchar("invoice_number", { length: 32 }).notNull().unique(),
    // numéro hérité de l'ancien système (YYMMCCNN), pour double équivalence
    legacyNumber: varchar("legacy_number", { length: 32 }),

    type: invoiceType("type").notNull().default("invoice"),
    orderId: uuid("order_id").references(() => orders.id),
    clientId: uuid("client_id").notNull().references(() => clients.id),

    // snapshot identité client au moment de l'émission (figé)
    clientSnapshot: jsonb("client_snapshot").$type<{
      name: string;
      legalName?: string;
      siret?: string;
      vatNumber?: string;
      billingAddress?: string;
      billingCity?: string;
      billingZip?: string;
      shippingAddress?: string;
      shippingCity?: string;
      shippingZip?: string;
    }>().notNull(),

    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    paymentTerms: text("payment_terms"),

    totalHt: numeric("total_ht", { precision: 14, scale: 2 }).notNull(),
    totalVat: numeric("total_vat", { precision: 14, scale: 2 }).notNull(),
    totalTtc: numeric("total_ttc", { precision: 14, scale: 2 }).notNull(),

    // ventilation TVA par taux (pour pied de facture multi-taux)
    vatBreakdown: jsonb("vat_breakdown").$type<Array<{
      rate: string; // "20.00"
      base: string; // base HT
      vat: string;  // montant TVA
    }>>().notNull(),

    pdfBlobUrl: text("pdf_blob_url"), // Vercel Blob — archive immuable
    pdfBlobPath: text("pdf_blob_path"),

    status: invoiceStatus("status").notNull().default("issued"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }),

    // référence à une facture annulée par celle-ci (pour avoirs)
    cancelsInvoiceId: uuid("cancels_invoice_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoices_client_idx").on(t.clientId),
    index("invoices_issue_date_idx").on(t.issueDate),
    uniqueIndex("invoices_legacy_idx").on(t.legacyNumber),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),

  // tout en snapshot — une fois la facture émise, ces données sont immuables
  code: varchar("code", { length: 32 }).notNull(),
  designation: text("designation").notNull(),
  conditionnement: text("conditionnement"),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unitPriceHt: numeric("unit_price_ht", { precision: 12, scale: 4 }).notNull(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0.00"),
  lineTotalHt: numeric("line_total_ht", { precision: 14, scale: 2 }).notNull(),

  position: integer("position").notNull().default(0),
});

// =====================================================================
// FACTURES FOURNISSEURS (factures reçues, dettes — entité légale immuable)
// =====================================================================

export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Numéro émis par le fournisseur sur SA facture (référence externe)
    supplierInvoiceNumber: varchar("supplier_invoice_number", { length: 64 }).notNull(),

    type: invoiceType("type").notNull().default("invoice"),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),

    // snapshot identité fournisseur au moment de l'import
    supplierSnapshot: jsonb("supplier_snapshot").$type<{
      name: string;
      legalName?: string;
      siret?: string;
      vatNumber?: string;
      address?: string;
    }>().notNull(),

    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    paymentTerms: text("payment_terms"),

    totalHt: numeric("total_ht", { precision: 14, scale: 2 }).notNull(),
    totalVat: numeric("total_vat", { precision: 14, scale: 2 }).notNull(),
    totalTtc: numeric("total_ttc", { precision: 14, scale: 2 }).notNull(),

    vatBreakdown: jsonb("vat_breakdown").$type<Array<{
      rate: string;
      base: string;
      vat: string;
    }>>().notNull(),

    pdfBlobUrl: text("pdf_blob_url"),
    pdfBlobPath: text("pdf_blob_path"),

    status: invoiceStatus("status").notNull().default("issued"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("supplier_invoices_supplier_number_idx").on(
      t.supplierId,
      t.supplierInvoiceNumber,
    ),
    index("supplier_invoices_supplier_idx").on(t.supplierId),
    index("supplier_invoices_issue_date_idx").on(t.issueDate),
  ],
);

export const supplierInvoiceLines = pgTable("supplier_invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierInvoiceId: uuid("supplier_invoice_id")
    .notNull()
    .references(() => supplierInvoices.id, { onDelete: "cascade" }),

  designation: text("designation").notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unitPriceHt: numeric("unit_price_ht", { precision: 12, scale: 4 }).notNull(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
  lineTotalHt: numeric("line_total_ht", { precision: 14, scale: 2 }).notNull(),

  position: integer("position").notNull().default(0),
});

// =====================================================================
// COMMANDES FOURNISSEURS (POs sortants — pas encore utilisé)
// =====================================================================

export const supplierOrders = pgTable("supplier_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNumber: varchar("order_number", { length: 32 }).notNull().unique(), // ex "BC-2026-0007"
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: orderStatus("status").notNull().default("draft"),
  dateCreated: date("date_created").notNull().defaultNow(),
  dateDeliveryPlanned: date("date_delivery_planned"),
  totalHt: numeric("total_ht", { precision: 14, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplierOrderLines = pgTable("supplier_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierOrderId: uuid("supplier_order_id").notNull().references(() => supplierOrders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id),
  codeSnapshot: varchar("code_snapshot", { length: 32 }).notNull(),
  designationSnapshot: text("designation_snapshot").notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unitPriceHt: numeric("unit_price_ht", { precision: 12, scale: 4 }).notNull(),
  lineTotalHt: numeric("line_total_ht", { precision: 14, scale: 2 }).notNull(),
  position: integer("position").notNull().default(0),
});

// =====================================================================
// COMPTA — Plan comptable, journaux, écritures
// =====================================================================

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 16 }).notNull().unique(), // ex "411", "707", "44566"
  label: text("label").notNull(),
  parentCode: varchar("parent_code", { length: 16 }),
  classCode: varchar("class_code", { length: 1 }).notNull(), // 1..7 (PCG classes)
  nature: varchar("nature", { length: 16 }).notNull(), // actif|passif|charge|produit|tiers|tva
  active: boolean("active").notNull().default(true),
});

export const accountingPeriods = pgTable("accounting_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  label: text("label").notNull(), // ex "Exercice 2026"
  status: varchar("status", { length: 16 }).notNull().default("open"), // open|closed
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodId: uuid("period_id").notNull().references(() => accountingPeriods.id),
  entryNumber: varchar("entry_number", { length: 32 }).notNull().unique(), // séquentiel
  date: date("date").notNull(),
  journal: journalCode("journal").notNull(),
  label: text("label").notNull(),

  // lien vers le document métier qui a généré l'écriture
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  supplierOrderId: uuid("supplier_order_id").references(() => supplierOrders.id),

  status: journalEntryStatus("status").notNull().default("draft"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  accountCode: varchar("account_code", { length: 16 }).notNull(),
  label: text("label").notNull(),
  debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0.00"),
  credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0.00"),
  position: integer("position").notNull().default(0),
});

// =====================================================================
// IMPORT HISTORIQUE FACTURES (brouillons avant matérialisation)
// =====================================================================

export const invoiceImportStatus = pgEnum("invoice_import_status", [
  "pending",      // upload OK, en attente d'extraction
  "extracted",    // extraction LLM faite, prête à valider
  "needs_review", // extraction incomplète ou client non matché
  "materialized", // injectée dans `invoices`, on peut archiver l'import
  "failed",
]);

export const invoiceImports = pgTable(
  "invoice_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pdfBlobUrl: text("pdf_blob_url").notNull(),
    pdfBlobPath: text("pdf_blob_path").notNull(),
    sourceFilename: text("source_filename"),

    direction: invoiceDirection("direction").notNull().default("client"),
    status: invoiceImportStatus("status").notNull().default("pending"),
    errorMessage: text("error_message"),

    // données brutes renvoyées par l'extraction LLM (typé comme l'output Zod
    // de invoiceExtractionSchema dans lib/invoice-extract.ts)
    extracted: jsonb("extracted").$type<{
      legacyNumber: string | null;
      issueDate: string | null;
      dueDate: string | null;
      clientGuess: {
        name: string | null;
        siret: string | null;
        address: string | null;
      };
      lines: Array<{
        designation: string;
        qty: number;
        unitPriceHt: number;
        vatRate: number;
        lineTotalHt: number | null;
      }>;
      totals: { totalHt: number; totalVat: number; totalTtc: number };
      vatBreakdown: Array<{ rate: number; base: number; vat: number }>;
    }>(),

    // matching après extraction (manuel ou auto par SIRET / nom)
    matchedClientId: uuid("matched_client_id").references(() => clients.id),
    matchedSupplierId: uuid("matched_supplier_id").references(() => suppliers.id),
    materializedInvoiceId: uuid("materialized_invoice_id").references(() => invoices.id),
    materializedSupplierInvoiceId: uuid("materialized_supplier_invoice_id").references(() => supplierInvoices.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoice_imports_status_idx").on(t.status)],
);

// =====================================================================
// BANQUE — Qonto (relevés mensuels)
// =====================================================================

export const bankStatements = pgTable(
  "bank_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qontoStatementId: text("qonto_statement_id").notNull().unique(),
    bankAccountId: text("bank_account_id").notNull(),
    period: varchar("period", { length: 7 }).notNull(), // MM-YYYY
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    pdfBlobUrl: text("pdf_blob_url").notNull(),
    pdfBlobPath: text("pdf_blob_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bank_statements_period_idx").on(t.bankAccountId, t.period)],
);

// =====================================================================
// BANQUE — Qonto (transactions)
// =====================================================================

export const qontoTransactions = pgTable(
  "qonto_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qontoId: text("qonto_id").notNull().unique(),
    date: date("date").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    label: text("label"),
    counterpartyName: text("counterparty_name"),
    qontoCategory: text("qonto_category"),
    attachmentUrl: text("attachment_url"),

    // rapprochement
    matchedInvoiceId: uuid("matched_invoice_id").references(() => invoices.id),
    matchedSupplierInvoiceId: uuid("matched_supplier_invoice_id").references(() => supplierInvoices.id),
    matchedSupplierOrderId: uuid("matched_supplier_order_id").references(() => supplierOrders.id),
    // Classification non-facture : la transaction est tracée par une écriture
    // comptable (avance assoc., frais bancaires, TVA, etc.) plutôt que par
    // une facture. La présence de journalEntryId fait foi.
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    matchNote: text("match_note"),

    rawJson: jsonb("raw_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qonto_date_idx").on(t.date)],
);
