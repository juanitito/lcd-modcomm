import { ComingSoon } from "@/components/coming-soon";

export default function AccountingPage() {
  return (
    <ComingSoon
      title="Comptabilité"
      todos={[
        "Plan comptable général embarqué (PCG)",
        "Saisie d'écritures (journaux VE / AC / BQ / OD)",
        "Génération auto depuis factures et opérations Qonto",
        "Livre journal, grand livre, balance",
        "Export FEC pour l'expert-comptable",
        "Pré-bilan & pré-compte de résultat",
      ]}
    />
  );
}
