/**
 * Les superpositions — ce que le bouton retour doit fermer avant de reculer.
 *
 * ============================================================== POURQUOI
 *
 * Le fil de Regalica, la visionneuse, le détail des lignes, le scanner, une
 * confirmation : autant d'écrans plein écran qui sont de l'ÉTAT local, pas des
 * routes. Le bouton retour d'Android ne les voit pas — il traverse tout et
 * sort de la pièce, alors que la personne voulait seulement fermer ce qu'elle
 * venait d'ouvrir.
 *
 * Une pile, sans React : chaque superposition ouverte y dépose de quoi la
 * fermer ; le retour ferme la dernière, et ne recule que si la pile est vide.
 */

const pile: Array<() => void> = [];

/** Dépose une superposition ; rend ce qui la retire. */
export function ouvrirSuperposition(fermer: () => void): () => void {
  pile.push(fermer);
  return () => {
    const i = pile.lastIndexOf(fermer);
    if (i >= 0) pile.splice(i, 1);
  };
}

/** Ferme la dernière superposition ouverte. Vrai s'il y en avait une. */
export function fermerLaDerniereSuperposition(): boolean {
  const fermer = pile.pop();
  if (!fermer) return false;
  fermer();
  return true;
}

export function nombreDeSuperpositions(): number {
  return pile.length;
}
