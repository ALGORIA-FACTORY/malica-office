/**
 * Le hasard graine des jeux fabriqués — un seul générateur pour tous.
 *
 * Le jeu synthétique (`composer.mjs`, `rendre.mjs`, `page.mjs`) et le jeu
 * d'ALGORIA (`outils/jeu-algoria/`) tirent tout ce qui varie de ce générateur :
 * relancer un jeu réécrit des fichiers identiques à l'octet. Il était recopié
 * dans le compositeur et dans le rendu ; il ne vit plus qu'ici.
 */

/** mulberry32 : un générateur de 32 bits, graine entière, valeurs dans [0, 1[. */
export function mulberry32(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Les tirages d'un générateur : `tirer(min, max)`, un entier dans [min, max[
 * — la signature de `crypto.randomInt`, que `matriculeDEssai` attend — et
 * `choisir(liste)`, un élément.
 */
export function tirages(hasard) {
  const tirer = (min, max) => min + Math.floor(hasard() * (max - min));
  return { tirer, choisir: (liste) => liste[tirer(0, liste.length)] };
}
