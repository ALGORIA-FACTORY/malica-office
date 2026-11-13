/**
 * Les étapes qu'on verra vraiment, pour le « n sur m » de la tête de
 * « Ajouter des pièces » (planche 9, 7 novembre 2026).
 *
 * UNE numérotation, qui ne bouge pas en route (13 novembre 2026, G6a : le
 * total passait de 8 à 6 quand les questions et les dates se révélaient
 * vides). Les questions (5) et les dates (6) sont des temps de « Vérifier »
 * (4) : elles ne se comptent pas à part. La fin privée saute la lecture
 * (« Pour qui ? » puis « Terminé »).
 */
export function etapesVisibles(prive: boolean): number[] {
  return prive ? [1, 8] : [1, 2, 3, 4, 7, 8];
}

/** Le rang montré d'une étape : 5 et 6 sont des temps de « Vérifier ». */
export function rangDeLEtape(etape: number, prive: boolean): number {
  const visibles = etapesVisibles(prive);
  const portee = etape === 5 || etape === 6 ? 4 : etape;
  const i = visibles.indexOf(portee);
  return i >= 0 ? i + 1 : Math.max(1, visibles.filter((e) => e <= portee).length);
}
