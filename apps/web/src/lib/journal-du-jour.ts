/**
 * Le journal du jour, côté écran : le jour lu dans l'adresse, ses voisins,
 * et ce qu'un écart depuis l'export précédent a à dire.
 *
 * Le jour « d'aujourd'hui » n'est PAS calculé ici : il est celui du cabinet,
 * dans son fuseau (un réglage du cabinet, au défaut de sa juridiction), et
 * l'API le rend. L'horloge du poste n'en décide pas (décision du dirigeant,
 * 29 octobre 2026).
 *
 * Rien ici ne calcule un montant : les totaux viennent de l'API.
 */
import type { EcartDepuisLExport } from "@malica/socle/ports/repositories";

import type { MessageKey } from "@/i18n";

const JOUR_MS = 86_400_000;

/** Le jour d'avant ou d'après, en jours calendaires. */
export function jourVoisin(jour: string, decalage: number): string {
  return new Date(Date.parse(`${jour}T00:00:00Z`) + decalage * JOUR_MS).toISOString().slice(0, 10);
}

/** Un jour lu dans l'adresse : AAAA-MM-JJ, et une vraie date ; sinon rien. */
export function jourLisible(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  // « 2026-13-45 » a la forme d'un jour sans en être un : `new Date` le rend
  // invalide, et `toISOString` lèverait au milieu du rendu (recette du 29/10).
  const jour = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(jour.getTime())) return undefined;
  return jour.toISOString().slice(0, 10) === v ? v : undefined;
}

/** Combien d'écritures ont bougé depuis l'export précédent. */
export function nombreDeChangements(ecart: EcartDepuisLExport): number {
  return ecart.ajoutees + ecart.contrePassees + ecart.retirees;
}

/**
 * Les seules parties NON NULLES d'un écart, dans l'ordre où elles se lisent :
 * « retirées : 1 » se dit seul, sans « ajoutées : 0 » devant (revue de #129).
 */
export function partiesDeLEcart(ecart: EcartDepuisLExport): Array<{ cle: MessageKey; n: number }> {
  const parties: Array<{ cle: MessageKey; n: number }> = [
    { cle: "cab.jdj.ecart.ajoutees", n: ecart.ajoutees },
    { cle: "cab.jdj.ecart.contrePassees", n: ecart.contrePassees },
    { cle: "cab.jdj.ecart.retirees", n: ecart.retirees },
  ];
  return parties.filter((p) => p.n > 0);
}
