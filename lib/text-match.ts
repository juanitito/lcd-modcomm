// Heuristiques de matching de noms (clients/fournisseurs sur factures vs Qonto).
// Combine deux signaux :
//  - chevauchement de tokens (mots ≥2 lettres)
//  - similarité de la chaîne alphanumérique pure (utile pour les noms type
//    "M.R.Net" qui se réduisent à un seul token quand on filtre les 1-lettre)
// Rend un score 0..1.

function normalizeAlnum(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function tokens(s: string): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// Score de similarité entre deux noms.
//  1.0 si la chaîne alnum la plus courte (≥4 chars) est contenue dans l'autre
//      (couvre "MrNet" vs "M.R.Net" ou "Copafrais" vs "SARL COPAFRAIS")
//  Sinon le ratio de chevauchement de tokens.
export function nameMatchScore(a: string, b: string): number {
  const overlap = tokenOverlap(a, b);
  if (overlap >= 1) return 1;

  const na = normalizeAlnum(a);
  const nb = normalizeAlnum(b);
  if (na.length >= 4 && nb.length >= 4) {
    if (na.includes(nb) || nb.includes(na)) return 1;
  }
  return overlap;
}
