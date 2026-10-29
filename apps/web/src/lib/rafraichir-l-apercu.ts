import type { QueryClient } from "@tanstack/react-query";

/**
 * Relance l'aperçu d'une pièce dont les octets viennent d'arriver.
 *
 * Une pièce photographiée hors ligne existe avant ses octets : son aperçu
 * (`ApercuDePiece`, clé `["apercu", taille, pieceId]`) a pu lire « contenu
 * absent ». La file hors ligne l'appelle quand elle les a déposés.
 */
export function rafraichirLApercu(qc: QueryClient, pieceId: string): Promise<void> {
  return qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === "apercu" && q.queryKey[2] === pieceId,
  });
}
