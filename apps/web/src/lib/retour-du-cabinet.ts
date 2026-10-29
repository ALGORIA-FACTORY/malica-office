/**
 * Ce qu'un retour du cabinet demande au client, dit en un geste.
 *
 * Maquette « Retours du cabinet et pièces à confirmer », validée le
 * 25 octobre 2026. Le geste vient du référentiel (`ref.rejet_motifs.geste`) :
 * le cabinet choisit un motif, et le client lit UNE action, la même sur
 * l'aperçu du cabinet et sur la fiche de la pièce — d'où ce tableau unique.
 */
import type { GesteDeRetour } from "@malica/socle/ports/repositories";

import type { MessageKey } from "@/i18n";

export const LIBELLE_DU_GESTE: Record<GesteDeRetour, MessageKey> = {
  joindre_document: "pme.retour.geste.joindre_document",
  joindre_facture_conforme: "pme.retour.geste.joindre_facture_conforme",
  reprendre_photo: "pme.retour.geste.reprendre_photo",
  corriger_date: "pme.retour.geste.corriger_date",
  repondre: "pme.retour.geste.repondre",
  demander_suppression: "pme.retour.geste.demander_suppression",
  voir_reglement: "pme.retour.geste.voir_reglement",
};

/**
 * Ce que dit la ligne « c'est fait », quand le geste laisse une trace que la
 * base sait dater après le retour. Les gestes sans trace (`voir_reglement`,
 * `demander_suppression`) n'en ont pas : ils n'attendent rien pour renvoyer.
 */
export const FAIT_DU_GESTE: Partial<Record<GesteDeRetour, MessageKey>> = {
  joindre_document: "pme.retour.fait.joindre",
  joindre_facture_conforme: "pme.retour.fait.joindre",
  reprendre_photo: "pme.retour.fait.photo",
  corriger_date: "pme.retour.fait.date",
  repondre: "pme.retour.fait.reponse",
};

/**
 * Les sorties d'une pièce retournée (« Malica sans blocage », 28 octobre
 * 2026) : rien ne bloque. `geste` est le geste propre au motif quand aucune
 * autre sortie ne le porte déjà (joindre un document, corriger la date, voir
 * le règlement).
 */
export type SortieDuRetour =
  "geste" | "renvoyer" | "reprendre_photo" | "repondre" | "garder" | "supprimer";

/** Le geste du motif, dit par la sortie qui le fait quand il y en a une. */
const SORTIE_DU_GESTE: Partial<Record<GesteDeRetour, SortieDuRetour>> = {
  reprendre_photo: "reprendre_photo",
  repondre: "repondre",
  demander_suppression: "supprimer",
};

/**
 * Dans l'ordre de l'écran, chacune une fois : la principale d'abord — le
 * geste demandé tant qu'il n'est pas fait, « Renvoyer » ensuite —, puis les
 * autres.
 */
export function sortiesDuRetour(geste: GesteDeRetour, fait: boolean): SortieDuRetour[] {
  const duMotif = SORTIE_DU_GESTE[geste] ?? "geste";
  const ordre: SortieDuRetour[] = fait
    ? ["renvoyer", duMotif, "reprendre_photo", "repondre", "garder", "supprimer"]
    : [duMotif, "renvoyer", "reprendre_photo", "repondre", "garder", "supprimer"];
  return [...new Set(ordre)];
}
