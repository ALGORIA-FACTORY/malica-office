/**
 * Déclarer une superposition au bouton retour, le temps qu'elle est ouverte.
 *
 *   useSuperposition(montrerPiece, () => setPiece(false));
 *
 * Ouverte, elle est sur la pile ; fermée — par son propre bouton ou par le
 * retour —, elle n'y est plus. Rien à faire de plus dans l'écran.
 */
import { useEffect } from "react";

import { ouvrirSuperposition } from "@/lib/superpositions";

export function useSuperposition(ouverte: boolean, fermer: () => void): void {
  useEffect(() => {
    if (!ouverte) return undefined;
    return ouvrirSuperposition(fermer);
  }, [ouverte, fermer]);
}
