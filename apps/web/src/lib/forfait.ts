/**
 * Ce que l'abonnement ouvre — décidé À UN SEUL ENDROIT.
 *
 * ================================================================== POURQUOI
 *
 * Il y en avait deux, et elles ne disaient pas la même chose. L'accueil
 * ouvrait les sièges sur `offre === "team" || offre === "premium"` ; les
 * réglages les ouvraient sur `sieges_max > 1`. Deux écrans jugeaient donc le
 * même fait sur deux données différentes, et le jour où une offre « team »
 * sans siège existe — ou l'inverse — les deux écrans se contredisent devant
 * le client qui paye.
 *
 * ========================================================== CE QUI DÉCIDE, ET OÙ
 *
 * Les sièges se décident sur le NOMBRE que la base rend : `sieges_max`, qui
 * vaut 0 pour Basic et Solo et plus pour Team et Premium. Aucun nom d'offre
 * n'est comparé, aucun seuil n'est écrit : « cette offre porte-t-elle au
 * moins une place ? » se lit dans la donnée.
 *
 * Les sociétés, elles, se décident encore sur le nom de l'offre, et c'est une
 * dette NOMMÉE : `ref.offres.organisations_max` existe (1 partout sauf
 * Premium, à 10) mais ni `facturation.consommation_v` ni `public.mon_forfait()`
 * ne le rendent. Le jour où la base le rend, cette ligne devient
 * `nombre(f.organisations_max) > 1` et plus un seul nom d'offre ne subsiste
 * dans le TypeScript.
 *
 * ====================================================== L'ABSENCE N'OUVRE RIEN
 *
 * `null` — chargement, échec, ou licence absente — ferme les deux. Un client
 * Premium dont l'appel échoue voit donc ses cartes payées verrouillées, et les
 * écrans disent « verrouillé parce que le forfait n'est pas lu, pas parce
 * qu'il est refusé ». C'est la bonne façon de se tromper : l'inverse
 * montrerait un bloc vide en promettant une fonction que le forfait ne porte
 * peut-être pas.
 */
import type { MonForfait } from "@malica/socle/ports/repositories";

/**
 * Un entier rendu par la base, ou `null`. Jamais `0` par défaut : zéro est un
 * fait, l'absence n'en est pas un, et les confondre sur un compteur de quota
 * ferait croire à un plafond atteint.
 */
export function nombre(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Ce que l'écran peut ouvrir. Tout est fermé tant que le forfait n'est pas lu. */
export interface OuverturesDuForfait {
  /** Le bloc des sièges : inviter un collaborateur, reprendre sa place. */
  sieges: boolean;
  /** Plusieurs sociétés sous une seule licence, et le sélecteur qui va avec. */
  societes: boolean;
}

export function ouverturesDuForfait(f: MonForfait | null | undefined): OuverturesDuForfait {
  if (!f) return { sieges: false, societes: false };
  const places = nombre(f.sieges_max);
  return {
    sieges: places !== null && places > 0,
    societes: f.offre === "premium",
  };
}
