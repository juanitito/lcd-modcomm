// Registre des classifications non-facture (importable depuis les composants
// client : aucun import server-only ici).

// Comptes PCG utilisés par les classifications. Le seeding effectif vit dans
// lib/accounting.ts (server-only).
export const PCG_ACCOUNTS: Record<
  string,
  { label: string; parentCode: string | null; classCode: string; nature: string }
> = {
  "512": { label: "Banque", parentCode: "51", classCode: "5", nature: "actif" },
  "455": {
    label: "Associés — comptes courants",
    parentCode: "45",
    classCode: "4",
    nature: "tiers",
  },
  "6061": {
    label: "Fournitures non stockables (eau, énergie, carburants)",
    parentCode: "606",
    classCode: "6",
    nature: "charge",
  },
  "401": {
    label: "Fournisseurs",
    parentCode: "40",
    classCode: "4",
    nature: "tiers",
  },
  "411": {
    label: "Clients",
    parentCode: "41",
    classCode: "4",
    nature: "tiers",
  },
  "6788": {
    label: "Autres charges exceptionnelles",
    parentCode: "678",
    classCode: "6",
    nature: "charge",
  },
  "627": {
    label: "Services bancaires et assimilés",
    parentCode: "62",
    classCode: "6",
    nature: "charge",
  },
  // Capitaux propres
  "101": {
    label: "Capital",
    parentCode: "10",
    classCode: "1",
    nature: "passif",
  },
  // Tiers — détails (tous les sous-comptes par tiers seront créés à la volée
  // sous le format {base}-{code}, ex 411-COPA, 401-CASI)
  "44566": {
    label: "TVA déductible sur autres biens et services",
    parentCode: "4456",
    classCode: "4",
    nature: "tva",
  },
  "44571": {
    label: "TVA collectée 20%",
    parentCode: "4457",
    classCode: "4",
    nature: "tva",
  },
  "44572": {
    label: "TVA collectée 2,1% (Corse / art. 297 CGI)",
    parentCode: "4457",
    classCode: "4",
    nature: "tva",
  },
  "445810": {
    label: "TVA à reverser / crédit de TVA",
    parentCode: "4458",
    classCode: "4",
    nature: "tva",
  },
  // Charges principales
  "607": {
    label: "Achats de marchandises",
    parentCode: "60",
    classCode: "6",
    nature: "charge",
  },
  // Produits principaux
  "707": {
    label: "Ventes de marchandises",
    parentCode: "70",
    classCode: "7",
    nature: "produit",
  },
  "7063": {
    label: "Primes accessoires (parrainage bancaire, etc.)",
    parentCode: "706",
    classCode: "7",
    nature: "produit",
  },
  "467": {
    label: "Autres débiteurs et créditeurs divers",
    parentCode: "46",
    classCode: "4",
    nature: "tiers",
  },
  "6242": {
    label: "Transports sur ventes",
    parentCode: "624",
    classCode: "6",
    nature: "charge",
  },
};

// Pour ajouter un cas : étendre ce registre + référencer le compte dans
// PCG_ACCOUNTS si nouveau. Aucune autre modif requise.
//
// `side: "credit"` = crédit en banque (montant > 0), `side: "debit"` = débit.
// `debit/credit` indiquent les comptes débité/crédité dans l'écriture créée.
export const CLASSIFICATION_KINDS = {
  owner_advance: {
    label: "Avance compte courant associé",
    shortLabel: "Avance assoc.",
    side: "credit",
    debit: "512",
    credit: "455",
  },
  fuel_no_receipt: {
    label: "Carburant sans ticket",
    shortLabel: "Carburant ss ticket",
    side: "debit",
    debit: "6061",
    credit: "512",
  },
  // Bank-side d'un avoir reçu d'un fournisseur (le fournisseur nous rembourse).
  // L'avoir fournisseur lui-même (réduction de la charge initiale) doit être
  // enregistré séparément en supplierInvoices type=credit_note.
  supplier_credit_note_refund: {
    label: "Avoir fournisseur remboursé",
    shortLabel: "Av. fourn. remb.",
    side: "credit",
    debit: "512",
    credit: "401",
  },
  // Bank-side d'un avoir émis à un client (on le rembourse). L'avoir lui-même
  // (réduction du CA + TVA collectée) doit être enregistré séparément en
  // invoices type=credit_note.
  client_credit_note_refund: {
    label: "Avoir client remboursé",
    shortLabel: "Av. client remb.",
    side: "debit",
    debit: "411",
    credit: "512",
  },
  // Pénalité commerciale ponctuelle (refus de prélèvement, frais de
  // recouvrement, etc.) facturée par un fournisseur. Utilisable seul
  // (avec une tx dédiée à la pénalité) ou en split d'une tx mixte
  // paiement + pénalité.
  supplier_penalty: {
    label: "Pénalité fournisseur",
    shortLabel: "Pénalité fourn.",
    side: "debit",
    debit: "6788",
    credit: "512",
  },
  // Frais bancaires (abonnement Qonto, frais de virement, prélèvements
  // bancaires sans facture, etc.). À utiliser quand le débit n'a pas de
  // facture justificative associée.
  bank_fee: {
    label: "Frais bancaires",
    shortLabel: "Frais bancaires",
    side: "debit",
    debit: "627",
    credit: "512",
  },
  // Prime de parrainage bancaire (Qonto et autres). Pas de facture émise par
  // la banque — c'est un produit accessoire enregistré directement.
  bank_referral_premium: {
    label: "Prime de parrainage bancaire",
    shortLabel: "Prime parrainage",
    side: "credit",
    debit: "512",
    credit: "7063",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    shortLabel: string;
    side: "credit" | "debit";
    debit: string;
    credit: string;
  }
>;

export type ClassificationKind = keyof typeof CLASSIFICATION_KINDS;

export const CLASSIFICATION_KINDS_BY_SIDE: Record<
  "credit" | "debit",
  Array<{ key: ClassificationKind; label: string; shortLabel: string }>
> = {
  credit: [],
  debit: [],
};
for (const [key, def] of Object.entries(CLASSIFICATION_KINDS)) {
  CLASSIFICATION_KINDS_BY_SIDE[def.side].push({
    key: key as ClassificationKind,
    label: def.label,
    shortLabel: def.shortLabel,
  });
}
