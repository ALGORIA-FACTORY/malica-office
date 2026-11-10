/**
 * Ce que la file du cabinet retient, avant de lire le détail des pièces.
 *
 * La file était coupée aux 200 pièces transmises les plus récentes, tous
 * statuts confondus (audit du 10 novembre 2026). Un cabinet qui a pris en
 * charge 200 pièces depuis voyait donc sortir de sa file une pièce plus
 * ancienne qu'il n'avait jamais traitée — pendant que le compteur du client,
 * lui, la comptait toujours « à traiter ».
 *
 * La règle :
 *   - ce qui ATTEND le cabinet n'est jamais coupé : une pièce reçue, vue ou
 *     corrigée (`A_TRAITER`, la règle des compteurs), et toute pièce portant
 *     une demande en attente, quel que soit son statut ;
 *   - le reste — chez le client, ou pris en charge — est une fenêtre sur le
 *     passé : les plus récentes seulement. La bibliothèque garde tout.
 */
import { A_TRAITER, type StatutCabinet } from "@malica/socle/statut-d-envoi";

/**
 * Le nombre de pièces qui n'attendent plus le cabinet que la file garde sous
 * les yeux. Une borne d'affichage, pas une règle de gestion : elle ne retire
 * rien de ce qui est à faire.
 */
export const FENETRE_DU_PASSE = 200;

export interface PieceTransmise {
  id: string;
  statut: StatutCabinet;
  /** Une demande (rappel, suppression) attend la réponse du cabinet. */
  demandeEnAttente: boolean;
}

/**
 * Les identifiants retenus. `pieces` arrive de la plus récemment envoyée à la
 * plus ancienne : la fenêtre garde les premières de ce qui n'attend plus.
 */
export function retenirPourLaFile(
  pieces: readonly PieceTransmise[],
  fenetre: number = FENETRE_DU_PASSE,
): string[] {
  const retenues: string[] = [];
  let duPasse = 0;
  for (const p of pieces) {
    if (p.demandeEnAttente || A_TRAITER.has(p.statut)) retenues.push(p.id);
    else if (duPasse < fenetre) {
      retenues.push(p.id);
      duPasse += 1;
    }
  }
  return retenues;
}
