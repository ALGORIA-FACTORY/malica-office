/**
 * Les cases d'un mois en calendrier — un découpage d'affichage, sans horloge ni fuseau.
 *
 * Les semaines commencent le lundi : c'est la convention du calendrier civil des
 * juridictions servies, pas une règle fiscale. Aucune date d'obligation n'est dérivée ici.
 */
import { finDuMois } from "@malica/socle/exercice";

/**
 * Les jours (`AAAA-MM-JJ`) du mois `AAAA-MM`, précédés d'autant de cases vides (`null`)
 * que de jours de la semaine avant le premier du mois.
 */
export function casesDuMois(mois: string): (string | null)[] {
  const dernier = Number(finDuMois(mois).slice(8));
  // getUTCDay : 0 = dimanche. Décalé pour que le lundi soit la première colonne.
  const premier = (new Date(`${mois}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const jours = Array.from(
    { length: dernier },
    (_, i) => `${mois}-${String(i + 1).padStart(2, "0")}`,
  );
  return [...Array<null>(premier).fill(null), ...jours];
}

/**
 * Pour chaque colonne, du lundi au dimanche, un jour du mois qui y tombe : la locale en
 * tire le nom du jour. Un mois compte au moins 28 jours, chaque colonne en a donc un.
 */
export function unJourParColonne(mois: string): string[] {
  const cases = casesDuMois(mois);
  return Array.from(
    { length: 7 },
    (_, colonne) => cases.find((c, i) => c !== null && i % 7 === colonne) as string,
  );
}
