/**
 * La structure de tableau d'une page — module pur.
 *
 * ============================================ CE QUI EST RÉUTILISÉ, ET POURQUOI
 *
 * `detectColumnBands` (`malica/lecture/article-repair.ts`) sait déjà lire les
 * entêtes imprimés d'un tableau de facture et en déduire la bande horizontale
 * de chaque colonne, en français comme en arabe. L'écrire une seconde fois
 * ici aurait produit deux détecteurs qui divergent au premier cas limite
 * corrigé d'un seul côté — exactement le défaut qui a coûté une facture
 * amputée le 18 octobre 2026.
 *
 * Ce module ne fait donc que trois choses que l'autre ne fait pas : il se
 * limite à une page, il range les colonnes dans l'ORDRE DE LECTURE (celui de
 * l'arabe n'est pas celui du français), et il ne garde que l'identité et le
 * rang — jamais l'abscisse, qu'un cadrage différent invaliderait.
 *
 * Ce qu'on en sait, et qui n'est pas corrigé ici : la clé comparée par
 * `detectColumnBands` retire les espaces, alors que le plan de jetons est
 * découpé en MOTS. Un entête arabe en deux mots — « سعر الوحدة » — ne peut
 * donc jamais être reconnu. La chaîne de lecture appartient à une autre tâche
 * et à R2 ; le constat est remonté, pas réparé en passant.
 */
import type { PageToken } from "@malica/socle/ports/malica";

import { detectColumnBands } from "../malica/lecture/article-repair.ts";

import type { Sens } from "./signature-ecriture.ts";

/** Une colonne reconnue, et sa place dans l'ordre de lecture. */
export interface ColonneSignature {
  colonne: string;
  rang: number;
}

/**
 * Les colonnes d'une page, dans l'ordre où un lecteur les rencontre.
 *
 * Une page mixte est rangée comme une page latine : il faut un ordre, et
 * celui-ci est le même des deux côtés d'une comparaison, donc il ne fausse
 * aucune distance. Ce n'est pas un repli silencieux — c'est écrit ici.
 */
export function colonnesDeLaPage(tokens: readonly PageToken[], sens: Sens): ColonneSignature[] {
  const droiteAGauche = sens === "rtl";
  return detectColumnBands(tokens)
    .map((b) => ({ colonne: b.column, centre: (b.x0 + b.x1) / 2 }))
    .sort((a, b) => (droiteAGauche ? b.centre - a.centre : a.centre - b.centre))
    .map((c, rang) => ({ colonne: c.colonne, rang }));
}
