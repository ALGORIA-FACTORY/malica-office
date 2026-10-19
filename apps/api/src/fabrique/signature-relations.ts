/**
 * L'ordre de lecture des ancres d'une page — module pur.
 *
 * ================================================================= POURQUOI
 *
 * Une coordonnée ne survit pas à une photo de biais ; un ORDRE, si. « La TVA
 * est juste au-dessus du total TTC » reste vrai quelle que soit la feuille,
 * le dpi, le cadrage et la pente — et c'est ce qui sépare deux formats
 * voisins quand les mêmes mots sont imprimés dans un ordre différent.
 *
 * ========================= POURQUOI UNE SUITE, ET NON TOUS LES COUPLES
 *
 * Ce module rendait TOUS les couples d'ancres uniques, chacun qualifié par
 * « dessus / dessous / même ligne » et « avant / après ». C'était faux de
 * conception, et la mesure l'a montré le 20 octobre 2026 : entre une facture
 * à prix unitaires HT et la même à prix unitaires TTC — dont le PIED EST
 * INVERSÉ —, la composante ne valait que **0,0330**. Trois couples
 * contredits, noyés dans quatre-vingt-onze.
 *
 * La cause n'est pas un réglage : c'est que la quasi-totalité des couples
 * d'une page s'accordent GRATUITEMENT. Que l'entête soit au-dessus du pied
 * est vrai de toute facture du monde ; ce couple n'a jamais rien séparé et il
 * pèse autant que celui qui sépare. Pire, ce que ces couples lointains disent
 * est déjà dit par la composante des bandes, qui les compte une seconde fois.
 *
 * La suite de lecture garde la seule relation qui porte de l'information : ce
 * qui suit quoi. Sur le même couple de formats, la composante passe de 0,0330
 * à **0,3077** — quatre liens de succession contredits sur treize —, et le
 * nombre de liens est linéaire et non plus quadratique.
 *
 * ================================================= TROIS REFUS QUI TIENNENT
 *
 *   — UNE ANCRE RÉPÉTÉE N'ENTRE PAS DANS LA SUITE. « Total » imprimé trois
 *     fois ne désigne rien à lui seul : dire ce qui le suit, c'est choisir
 *     laquelle des trois occurrences, donc fabriquer.
 *
 *   — LE SENS DE LECTURE DÉCIDE DE L'ORDRE DANS UNE LIGNE. En arabe, l'ancre
 *     qui précède est celle de DROITE. Une suite calculée sur l'abscisse
 *     croissante confondrait un format et son miroir.
 *
 *   — LES LIGNES SE JUGENT AU RECOUVREMENT, jamais à l'écart des centres :
 *     une page inclinée décale les centres, mais deux mots d'une même ligne
 *     continuent de se chevaucher.
 *
 * ================================================= CE QUE LA SUITE A COÛTÉ
 *
 * De la sensibilité, achetée contre de la tolérance. Un accident de mise en
 * page — deux ancres qui changent de ligne sur un exemplaire — contredit
 * deux liens sur treize et pèse désormais trois centièmes dans la distance,
 * là où il ne pesait presque rien. C'est le bon sens du marché : une
 * reconnaissance manquée rend la main au modèle, qui sait faire ; une
 * reconnaissance fautive rend une lecture prouvée et fausse.
 */
import type { AncrePlacee, AncreSignature } from "./signature-ancres.ts";

/** Une ancre dans la suite de lecture : sa ligne et sa colonne de page. */
export interface AncreEnLecture {
  cle: string;
  /** Deux ancres de même index sont sur la même ligne. */
  ligne: number;
  /** Deux ancres de même index sont dans la même colonne. */
  colonne: number;
}

export interface LectureDeLaPage {
  ancres: AncreEnLecture[];
  /**
   * Le plafond a coupé la suite : elle est PARTIELLE, donc incomparable.
   *
   * Ce n'est pas un détail de comptage. Une suite tronquée comparée comme si
   * elle était entière rendrait une distance trop PETITE — donc une
   * reconnaissance trop facile, dans la direction qui fait mal.
   */
  tronquee: boolean;
}

/**
 * Deux empans se recouvrent-ils assez pour être dits « sur la même ligne » ou
 * « dans la même colonne » ?
 *
 * Exporté le 18 octobre 2026 pour l'interprète déterministe, qui juge
 * exactement la même chose quand il résout « le voisin de droite » ou la
 * contrainte « meme_ligne ». L'écrire une seconde fois aurait donné deux
 * notions de « même ligne » qui divergent au premier cas limite corrigé d'un
 * seul côté — la faute même que ce dépôt a payée le 18 octobre au matin.
 */
export function serecouvrent(
  d0: number,
  d1: number,
  e0: number,
  e1: number,
  partMinimale: number,
): boolean {
  const commun = Math.min(d1, e1) - Math.max(d0, e0);
  if (commun <= 0) return false;
  const reference = Math.min(d1 - d0, e1 - e0);
  return reference > 0 ? commun / reference >= partMinimale : true;
}

/** Regroupe des empans qui se recouvrent, et rend l'index de groupe de chacun. */
function grouper(
  empans: ReadonlyArray<{ debut: number; fin: number }>,
  ordre: readonly number[],
  partMinimale: number,
): Map<number, number> {
  const index = new Map<number, number>();
  let groupe = -1;
  let tete: { debut: number; fin: number } | null = null;
  for (const i of ordre) {
    const e = empans[i]!;
    if (tete === null || !serecouvrent(tete.debut, tete.fin, e.debut, e.fin, partMinimale)) {
      groupe += 1;
      tete = e;
    }
    index.set(i, groupe);
  }
  return index;
}

/**
 * Les ancres UNIQUES d'une page, dans l'ordre où un lecteur les rencontre.
 *
 * Les lignes d'abord, de haut en bas ; dans une ligne, l'ordre de lecture de
 * son écriture. Les colonnes sont relevées en même temps : deux formats qui
 * posent les mêmes mots en une colonne ou en deux ne sont pas le même format,
 * et l'ordre seul ne le dirait pas.
 */
export function lectureDesAncres(
  placees: readonly AncrePlacee[],
  ancres: readonly AncreSignature[],
  droiteAGauche: boolean,
  recouvrementDeLigne: number,
  recouvrementDeColonne: number,
  maximum: number,
): LectureDeLaPage {
  const uniques = new Set(ancres.filter((a) => a.occurrences === 1).map((a) => a.cle));
  const retenues = placees.filter((p) => uniques.has(p.cle));
  if (retenues.length === 0) return { ancres: [], tronquee: false };

  const centre = (d: number, f: number) => (d + f) / 2;
  const indices = retenues.map((_, i) => i);

  const parLigne = grouper(
    retenues.map((p) => ({ debut: p.v0, fin: p.v1 })),
    [...indices].sort(
      (i, j) => centre(retenues[i]!.v0, retenues[i]!.v1) - centre(retenues[j]!.v0, retenues[j]!.v1),
    ),
    recouvrementDeLigne,
  );
  const sensHorizontal = (i: number, j: number) => {
    const d = centre(retenues[i]!.u0, retenues[i]!.u1) - centre(retenues[j]!.u0, retenues[j]!.u1);
    return droiteAGauche ? -d : d;
  };
  const parColonne = grouper(
    retenues.map((p) => ({ debut: p.u0, fin: p.u1 })),
    [...indices].sort(sensHorizontal),
    recouvrementDeColonne,
  );

  const suite = [...indices].sort(
    (i, j) => parLigne.get(i)! - parLigne.get(j)! || sensHorizontal(i, j),
  );

  return {
    ancres: suite.slice(0, maximum).map((i) => ({
      cle: retenues[i]!.cle,
      ligne: parLigne.get(i)!,
      colonne: parColonne.get(i)!,
    })),
    tronquee: suite.length > maximum,
  };
}
