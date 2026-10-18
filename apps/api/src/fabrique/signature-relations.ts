/**
 * Les relations spatiales entre ancres — module pur.
 *
 * ================================================================= POURQUOI
 *
 * Une coordonnée ne survit pas à une photo de biais ; un ORDRE, si. « La TVA
 * est au-dessus du total TTC » reste vrai quelle que soit la feuille, le dpi,
 * le cadrage et la pente — et c'est ce qui sépare deux formats voisins quand
 * les mêmes mots sont imprimés aux mêmes endroits dans un ordre différent.
 *
 * Deux refus, et ils tiennent toute la fiabilité de la mesure :
 *
 *   — UNE ANCRE RÉPÉTÉE N'ENTRE DANS AUCUNE RELATION. « Total » imprimé trois
 *     fois ne désigne rien à lui seul : dire qu'il est « au-dessus » de
 *     quelque chose, c'est choisir laquelle des trois occurrences, donc
 *     fabriquer. Le comptage la retient ; la relation la refuse.
 *
 *   — LE SENS DE LECTURE DÉCIDE DE « AVANT ». En arabe, l'ancre qui précède
 *     est celle de DROITE. Une relation calculée sur l'abscisse seule
 *     confondrait un format et son miroir.
 *
 * « Même ligne » et « même colonne » se jugent au RECOUVREMENT des boîtes, et
 * non à l'écart de leurs centres : une page inclinée décale les centres, mais
 * deux mots d'une même ligne continuent de se chevaucher.
 */
import type { AncrePlacee, AncreSignature } from "./signature-ancres.ts";

export type RelationVerticale = "dessus" | "dessous" | "meme_ligne";
export type RelationHorizontale = "avant" | "apres" | "meme_colonne";

/** « a » est au-dessus / avant « b ». Les clés sont rangées dans l'ordre. */
export interface RelationSignature {
  a: string;
  b: string;
  v: RelationVerticale;
  h: RelationHorizontale;
}

function serecouvrent(
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

/**
 * Les relations entre les ancres UNIQUES d'une page, par couples ordonnés.
 *
 * Le nombre de couples croît au carré : au-delà du maximum donné, on garde
 * les premières clés dans l'ordre alphabétique. Le choix est arbitraire, mais
 * il est DÉTERMINISTE, ce qui est la seule chose qu'on lui demande — deux
 * exemplaires du même format gardent les mêmes.
 */
export function relationsEntreAncres(
  placees: readonly AncrePlacee[],
  ancres: readonly AncreSignature[],
  droiteAGauche: boolean,
  recouvrementDeLigne: number,
  recouvrementDeColonne: number,
  maximum: number,
): RelationSignature[] {
  const uniques = ancres
    .filter((a) => a.occurrences === 1)
    .map((a) => a.cle)
    .slice(0, maximum);
  const parCle = new Map<string, AncrePlacee>();
  for (const p of placees) if (uniques.includes(p.cle)) parCle.set(p.cle, p);

  const sortie: RelationSignature[] = [];
  for (let i = 0; i < uniques.length; i += 1) {
    for (let j = i + 1; j < uniques.length; j += 1) {
      const a = parCle.get(uniques[i]!);
      const b = parCle.get(uniques[j]!);
      if (!a || !b) continue;
      const memeLigne = serecouvrent(a.v0, a.v1, b.v0, b.v1, recouvrementDeLigne);
      const memeColonne = serecouvrent(a.u0, a.u1, b.u0, b.u1, recouvrementDeColonne);
      const plusHaut = (a.v0 + a.v1) / 2 < (b.v0 + b.v1) / 2;
      const plusAGauche = (a.u0 + a.u1) / 2 < (b.u0 + b.u1) / 2;
      const precede = droiteAGauche ? !plusAGauche : plusAGauche;
      sortie.push({
        a: a.cle,
        b: b.cle,
        v: memeLigne ? "meme_ligne" : plusHaut ? "dessus" : "dessous",
        h: memeColonne ? "meme_colonne" : precede ? "avant" : "apres",
      });
    }
  }
  return sortie;
}
