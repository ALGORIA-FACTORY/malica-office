/**
 * La visibilité d'une pièce au moment où on la photographie.
 *
 * Une règle d'une ligne, isolée pour une raison : le produit s'est trompé dans
 * les deux sens à six semaines d'intervalle — tout partait, puis plus rien ne
 * partait — et chaque fois l'erreur était noyée dans un appel de capture de
 * quarante lignes. Ici, elle se lit, et `__tests__/visibilite-a-la-capture.test.ts`
 * dit pourquoi elle est ce qu'elle est.
 */

export type Visibilite = "personnel" | "partage";

export function visibiliteALaCapture(contexte: { mandatActif: boolean | undefined }): Visibilite {
  return contexte.mandatActif === true ? "partage" : "personnel";
}
