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
 * Les sociétés se décident sur `ref.offres.organisations_max`, que le
 * catalogue des offres rend (`facturation.catalogueDesOffres`, 22 octobre
 * 2026) : sans plafond ou au-delà d'une, l'offre ouvre plusieurs sociétés.
 * Elles se jugeaient jusque-là sur le nom « premium » — c'était la dette
 * nommée ici ; plus un seul nom d'offre ne subsiste dans ce jugement.
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
import type { MonForfait, OffreAuCatalogue } from "@malica/socle/ports/repositories";

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

/** L'offre ouvre-t-elle plusieurs sociétés ? Sans plafond, ou au-delà d'une. */
export function ouvreLesSocietes(o: OffreAuCatalogue): boolean {
  return o.organisations_max === null || Number(o.organisations_max) > 1;
}

export function ouverturesDuForfait(
  f: MonForfait | null | undefined,
  catalogue: readonly OffreAuCatalogue[] | undefined,
): OuverturesDuForfait {
  if (!f) return { sieges: false, societes: false };
  // Le catalogue non lu ferme les sociétés, comme le forfait non lu.
  const offre = catalogue?.find((o) => o.code === f.offre);
  const places = nombre(f.sieges_max);
  /*
   * Depuis la grille du 19 octobre, Team et Premium n'ont plus de plafond de
   * places : la base rend `sieges_max` VIDE. Vide ne veut pas dire « non lu »
   * quand le reste de la ligne l'est : `sieges_inclus` connu, c'est un
   * titulaire qui lit une offre sans plafond. Un collaborateur, lui, reçoit
   * les deux vides — et ne donne pas de place.
   */
  const sansPlafond = f.sieges_max === null && nombre(f.sieges_inclus) !== null;
  return {
    sieges: sansPlafond || (places !== null && places > 0),
    societes: offre ? ouvreLesSocietes(offre) : false,
  };
}
