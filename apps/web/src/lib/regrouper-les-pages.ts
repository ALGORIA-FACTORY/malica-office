/**
 * Les pages d'un scan, regroupées en factures.
 *
 * `liees[i]` relie la page i à la page i+1 : vrai, elles font la même
 * facture ; faux, une nouvelle facture commence. Rien de relié : une feuille
 * = une facture (voir `components/malica/regrouper-les-pages.tsx`).
 */
/** Les pages, regroupées en factures : `liees[i]` relie la page i à la page i+1. */
export function regrouper<T>(pages: readonly T[], liees: readonly boolean[]): T[][] {
  const groupes: T[][] = [];
  pages.forEach((page, i) => {
    if (i > 0 && liees[i - 1]) groupes[groupes.length - 1]!.push(page);
    else groupes.push([page]);
  });
  return groupes;
}
