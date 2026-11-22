/**
 * Le sens d'une pièce que la personne a CONFIRMÉ (à la capture, ou corrigé après la
 * lecture). Il entre dans la lecture comme un fait connu : il place le dossier (client d'un
 * achat, émetteur d'une vente), et l'autre matricule est le tiers. Un sens seulement LU
 * (« a_confirmer ») n'est pas une déclaration.
 */

/** Les deux sens de facture que la personne peut déclarer (`capture_precision_persist`). */
const SENS_DECLARABLES = { facture_achat: "achat", facture_vente: "vente" } as const;

/**
 * Le sens de la pièce que la personne a confirmé ; rien tant qu'il n'est que lu.
 *
 * Un type qui ne fixe pas le côté (un avoir) le dit à part : `coteDit`, la dernière
 * précision `sens` (22 novembre 2026). Une proposition de la PME au cabinet
 * (`sens_propose`) n'en est pas une.
 */
export function sensConfirme(
  kind: string | null,
  statut: string | null,
  coteDit: string | null = null,
): "achat" | "vente" | undefined {
  if (statut === "confirme" && kind && kind in SENS_DECLARABLES)
    return SENS_DECLARABLES[kind as keyof typeof SENS_DECLARABLES];
  if (coteDit && coteDit in SENS_DECLARABLES)
    return SENS_DECLARABLES[coteDit as keyof typeof SENS_DECLARABLES];
  return undefined;
}
