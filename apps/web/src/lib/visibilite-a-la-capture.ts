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

/**
 * ============================================= LE TROISIÈME ÉTAT DE CETTE RÈGLE
 *
 * 7 octobre 2026. Le commanditaire photographie une facture d'achat de SUARL
 * CASA-ELECT. Le produit la lit « facture de vente », la rejette au motif que
 * l'émetteur n'est pas ALGORIA — et elle est déjà **partie au cabinet**, parce
 * que la capture la marquait « partage » d'office sous mandat actif.
 *
 * « Facture transmise au cabinet malgré que la MF ne correspond pas. »
 *
 * Le défaut n'est pas le rejet : c'est d'avoir transmis AVANT de savoir. Une
 * pièce marquée partagée à la photo est partagée avant d'être lue, donc avant
 * que son verdict, son sens ou ses montants existent. Il n'y a aucun moment où
 * quelqu'un a pu décider.
 *
 * La capture repart donc en « personnel », et la transmission redevient une
 * RÉPONSE — à la fin de la lecture, quand la pièce est connue.
 *
 * ===================================== POURQUOI CE N'EST PAS LE RETOUR DU DÉFAUT
 *
 * Le 4 octobre, « rien ne partait » parce que le geste existait sans que rien
 * ne dise qu'il manquait. Ce qui change ici, et sans quoi ce retour en arrière
 * serait une faute : l'écran de vérification pose la question en deux boutons
 * de même poids — « Envoyer à [cabinet] » et « Garder pour moi » — et ne laisse
 * pas la pièce dans un état qu'on n'a pas choisi.
 *
 * Le mandat ne décide plus rien ici. Il décide s'il y a QUELQU'UN à qui
 * envoyer, ce que l'écran lit par lui-même.
 */
export function visibiliteALaCapture(_contexte: { mandatActif: boolean | undefined }): Visibilite {
  return "personnel";
}
