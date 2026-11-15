/**
 * Où la flèche des Réglages ramène quand on y est venu de la suite de l'arrivée (recette du
 * 14 novembre 2026, C1) : à la même étape de la suite, pas à l'accueil des Réglages.
 */
export type EtapeDeLaSuite = "forfait" | "comptabilite";

export function cibleDeRetourDesReglages(
  depuis: EtapeDeLaSuite | undefined,
):
  | { to: "/pme/suite"; search: { etape: EtapeDeLaSuite } }
  | { to: "/pme/reglages"; search: object } {
  return depuis
    ? { to: "/pme/suite", search: { etape: depuis } }
    : { to: "/pme/reglages", search: {} };
}
