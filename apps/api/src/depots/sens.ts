/**
 * Le sens d'une pièce que la personne a CONFIRMÉ (à la capture, ou corrigé après la
 * lecture). Il entre dans la lecture comme un fait connu : il place le dossier (client d'un
 * achat, émetteur d'une vente), et l'autre matricule est le tiers. Un sens seulement LU
 * (« a_confirmer ») n'est pas une déclaration.
 */

/** Les deux sens de facture que la personne peut déclarer (`capture_precision_persist`). */
const SENS_DECLARABLES = { facture_achat: "achat", facture_vente: "vente" } as const;

/** Le sens de la pièce que la personne a confirmé ; rien tant qu'il n'est que lu. */
export function sensConfirme(
  kind: string | null,
  statut: string | null,
): "achat" | "vente" | undefined {
  if (statut !== "confirme" || !kind || !(kind in SENS_DECLARABLES)) return undefined;
  return SENS_DECLARABLES[kind as keyof typeof SENS_DECLARABLES];
}
