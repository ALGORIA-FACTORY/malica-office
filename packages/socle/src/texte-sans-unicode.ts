/**
 * Un texte relevé qui ne se ramène pas à l'Unicode — donc qui ne se lit pas.
 *
 * ================================================================= POURQUOI
 *
 * Jeu synthétique, 31 octobre 2026 (cas 047) : un avoir arabe imprimé par
 * Chromium recevait une écriture d'ACHAT. Sa couche de texte ne porte aucun
 * texte arabe exploitable : les glyphes liés n'ont pas de correspondance
 * Unicode (`\u0000`), les autres sortent en formes de présentation isolées,
 * dans l'ordre visuel. Le titre « إشعار دائن » se relevait en lettres
 * détachées, aucun titre du référentiel ne s'y reconnaissait, et la pièce
 * passait pour une facture.
 *
 * Un texte perdu n'est pas un texte absent : on ne peut rien conclure de ce
 * qu'il ne dit pas. Ce prédicat le reconnaît, à trois signes :
 *
 *   — un caractère de contrôle (hors tabulation et fins de ligne), dont
 *     U+0000 : le glyphe que la police n'a pas su ramener à l'Unicode ;
 *   — U+FFFD, le caractère de remplacement : même constat, dit autrement ;
 *   — une forme de présentation arabe (U+FB50–U+FDFF, U+FE70–U+FEFF) : un
 *     glyphe contextuel qu'aucune table n'a ramené à sa lettre ; le mot qui
 *     la porte n'est plus dans l'ordre logique, il ne se compare à rien.
 *
 * Il sert deux fois : à la lecture (`pdf-text.ts`), pour ne pas croire une
 * couche de texte qui a perdu ses mots ; au jugement (`controles.ts`), pour ne
 * pas tirer la nature d'une pièce d'un titre qu'on n'a pas pu lire.
 */
// Les caractères de contrôle par leur classe Unicode (`\p{Cc}`), sauf la
// tabulation et les fins de ligne, et sauf les contrôles C1 (U+0080–U+009F),
// qui n'en faisaient pas partie : la même règle, sans caractère de contrôle
// écrit dans l'expression (`no-control-regex`).
const PERDU = /(?![\t\n\r\u0080-\u009f])[\p{Cc}�ﭐ-﷿ﹰ-﻾]/u;

export function texteSansUnicode(texte: string): boolean {
  return PERDU.test(texte);
}
