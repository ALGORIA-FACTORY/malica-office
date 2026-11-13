/**
 * Ce que dit l'écran « Ajouter une société » avant le geste (recette du 13 novembre 2026, A3).
 *
 * Aucun calcul : la licence a déjà dit combien de sociétés elle porte, l'offre combien elle en
 * comprend, la grille ce que coûte une société en plus. Ce module choisit la phrase — jamais le
 * chiffre — et un chiffre absent n'est pas dit.
 */
export type LigneDeLaSocieteEnPlus =
  | { cle: "pme.societe.propreAbonnement" }
  | { cle: "pme.societe.rejoint" }
  | { cle: "pme.societe.rejointInclus"; n: number; total: number }
  | { cle: "pme.societe.rejointEnPlus"; prix: string };

export function ligneDeLaSocieteEnPlus(
  /** Les sociétés déjà sur la licence ; `null` : pas lu. */
  actuelles: number | null,
  /** Les sociétés que l'offre comprend ; `null` : pas lu. */
  incluses: number | null,
  /** Le prix d'une société en plus, tel que la grille le donne ; `null` : pas lu. */
  prixEnPlus: string | null,
): LigneDeLaSocieteEnPlus {
  if (actuelles === null || incluses === null) return { cle: "pme.societe.rejoint" };
  // Une offre à une société : la nouvelle ne la rejoint pas, elle aura la sienne.
  if (incluses <= 1) return { cle: "pme.societe.propreAbonnement" };
  if (actuelles + 1 <= incluses) {
    return { cle: "pme.societe.rejointInclus", n: actuelles + 1, total: incluses };
  }
  return prixEnPlus !== null && Number(prixEnPlus) > 0
    ? { cle: "pme.societe.rejointEnPlus", prix: prixEnPlus }
    : { cle: "pme.societe.rejoint" };
}
