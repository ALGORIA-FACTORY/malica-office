/**
 * Les étapes qu'on verra vraiment, pour le « n sur m » de la tête de
 * « Ajouter des pièces » (planche 9, 7 novembre 2026).
 *
 * La fin privée saute la lecture (« Pour qui ? » puis « Terminé ») ; les
 * questions (5) et les dates (6) se sautent quand il n'y en a pas.
 */
export function etapesVisibles(prive: boolean, vide5: boolean, vide6: boolean): number[] {
  if (prive) return [1, 8];
  return [1, 2, 3, 4, ...(vide5 ? [] : [5]), ...(vide6 ? [] : [6]), 7, 8];
}
