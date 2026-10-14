/**
 * Découper un fragment de texte en mots, et situer chaque mot sur la page.
 *
 * ================================================================== POURQUOI ICI
 *
 * Aucun lecteur ne rend des mots. La couche texte d'un PDF rend des fragments,
 * Qwen rend des cellules, PaddleOCR rend des lignes. Le plan de jetons, lui,
 * raisonne en MOTS — c'est sa définition, et c'est ce qui permet au modèle de
 * désigner « le jeton 163 » plutôt que de recopier un montant.
 *
 * Ce découpage était écrit DEUX fois, dans deux fichiers, sous le même nom et
 * avec le même commentaire : `pdf-text.ts` et `qwen.ts`. Le 14 octobre 2026,
 * un troisième lecteur arrive, et une troisième copie aurait été une de trop :
 * la première qui aurait corrigé un cas limite aurait laissé les deux autres
 * en arrière.
 *
 * ============================================== CE QUE L'APPROXIMATION PROMET
 *
 * La largeur du fragment est répartie au prorata des caractères. C'est
 * approximatif, c'est assumé, et c'est sans conséquence : à l'intérieur d'un
 * fragment il n'y a pas de grand blanc, et cette largeur ne sert qu'à SITUER
 * le mot dans sa colonne — jamais à produire une valeur. Le texte, lui, est
 * exact.
 *
 * En écriture arabe, le premier mot logique est le plus à droite : la largeur
 * s'alloue depuis la droite, sans quoi une désignation pointerait à l'opposé
 * de ce qu'elle vise.
 */
import type { PageToken } from "@malica/socle/ports/malica";

/** Une boîte en coordonnées NORMALISÉES — de 0 à 1 dans la page. */
export interface Boite {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Les écritures qui se lisent de droite à gauche — l'arabe, ici, qui est l'une
 * des trois langues de Malica Office. Plages en échappements : écrites en
 * caractères littéraux, elles embarquent des espaces de largeur nulle.
 */
const RTL =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

/** Borne une coordonnée dans la page : rien ne se situe hors de la feuille. */
const borne = (v: number) => Math.max(0, Math.min(1, v));

export function decouperEnMots(
  fragment: string,
  boite: Boite,
  page: number,
  depuis: number,
): PageToken[] {
  const texte = fragment.trim();
  if (texte.length === 0) return [];

  const total = texte.length;
  const largeur = boite.x1 - boite.x0;
  const droiteAGauche = RTL.test(texte);
  const sortie: PageToken[] = [];
  let ordinal = depuis;

  for (const m of texte.matchAll(/\S+/g)) {
    const debut = m.index ?? 0;
    const part = total > 0 ? largeur / total : largeur;
    const x0 = droiteAGauche ? boite.x1 - part * (debut + m[0].length) : boite.x0 + part * debut;

    sortie.push({
      page,
      ordinal,
      text: m[0],
      x0: borne(x0),
      y0: borne(boite.y0),
      x1: borne(x0 + part * m[0].length),
      y1: borne(boite.y1),
    });
    ordinal += 1;
  }
  return sortie;
}
