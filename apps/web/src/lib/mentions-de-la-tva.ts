/**
 * Ce que l'écran de la TVA dit sous son titre : qui dépose, et si les chiffres sont une
 * estimation.
 *
 * Sans comptabilité mandatée, « C'est votre comptabilité qui dépose » est faux (pilote,
 * v0.2.125) : la phrase dit alors que la société dépose elle-même, et qu'il s'agit d'une
 * estimation. La mention « Estimation » séparée ne se répète pas : la phrase la porte déjà.
 */
export function mentionsDeLaTva(contexte: {
  /** L'offre montre l'axe par société (« Toutes les sociétés »). */
  parSociete: boolean;
  /** La lecture du cabinet a répondu : aucun. Inconnu (chargement, échec) n'est pas « aucun ». */
  sansCabinet: boolean;
  /** Le hook de la TVA compte des pièces que personne n'a reprises. */
  estimation: boolean;
}): {
  sous: "pme.tva.sousGroupe" | "pme.tva.sousSansCabinet" | "pme.tva.sous";
  estimation: boolean;
} {
  if (contexte.parSociete) return { sous: "pme.tva.sousGroupe", estimation: contexte.estimation };
  if (contexte.sansCabinet) return { sous: "pme.tva.sousSansCabinet", estimation: false };
  return { sous: "pme.tva.sous", estimation: contexte.estimation };
}
