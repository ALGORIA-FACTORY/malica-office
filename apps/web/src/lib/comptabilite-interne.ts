import type { Organization } from "@malica/socle/ports/repositories";

/**
 * La comptabilité que la personne ouvre est SA société, tenue en interne : son
 * espace est celui de la comptabilité externe, sans ce qui relève du cabinet
 * (honoraires, abonnements). Une organisation de type `pme` ne s'ouvre ici que
 * par le rôle de comptable interne (`supervision.listMyCabinets`).
 */
export function estComptabiliteInterne(org: Organization): boolean {
  return org.kind === "pme";
}
