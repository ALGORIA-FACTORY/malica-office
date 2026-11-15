/**
 * Ce que dit l'écran « Ajouter une société » avant le geste (recette du 13 novembre 2026, A3).
 *
 * Aucun calcul : la base dit QUELLE licence accueillerait la société (`societe_en_plus_devis`, la
 * même règle que la porte qui la rattache), son offre, ses sociétés, son inclus, et le prix d'une
 * société en plus. Ce module choisit la phrase — jamais le chiffre.
 */
import type { SocieteEnPlusAccueil } from "@malica/socle/ports/repositories";

export type LigneDeLaSocieteEnPlus =
  | { cle: "pme.societe.propreAbonnement" }
  | { cle: "pme.societe.offreMultisocieteRequise" }
  | { cle: "pme.societe.rejoint"; offre: string }
  | { cle: "pme.societe.rejointInclus"; offre: string; n: number; total: number }
  | { cle: "pme.societe.rejointEnPlus"; offre: string; prix: string };

/**
 * `accueil` : la licence qui l'accueillerait ; le refus que la porte opposerait (une offre à une
 * société) ; ou `null` — la société aura sa propre licence.
 */
export function ligneDeLaSocieteEnPlus(
  accueil: SocieteEnPlusAccueil | null,
): LigneDeLaSocieteEnPlus {
  if (accueil === null) return { cle: "pme.societe.propreAbonnement" };
  if ("offre_multisociete_requise" in accueil)
    return { cle: "pme.societe.offreMultisocieteRequise" };
  const {
    offre,
    organisations,
    organisations_incluses: total,
    prix_organisation_sup: prix,
  } = accueil;
  if (organisations + 1 <= total) {
    return { cle: "pme.societe.rejointInclus", offre, n: organisations + 1, total };
  }
  return Number(prix) > 0
    ? { cle: "pme.societe.rejointEnPlus", offre, prix }
    : { cle: "pme.societe.rejoint", offre };
}
