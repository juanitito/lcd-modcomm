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
