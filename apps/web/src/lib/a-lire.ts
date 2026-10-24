/**
 * Les pièces « à lire » : prises, et qui attendent encore une décision.
 *
 * 24 octobre 2026, parcours validé par Wissem : la lecture se fait tout de
 * suite ou plus tard, et pour plusieurs pièces choisies. « Plus tard » laisse
 * les pièces telles quelles ; l'accueil, la bibliothèque et l'écran « À lire »
 * les retrouvent par cette seule règle — trois copies d'un filtre divergent au
 * premier changement.
 *
 * À lire = capturée (pas encore lue), pas gardée pour soi (la question a été
 * posée et tranchée), et pas refusée (une lecture refusée a son propre écran,
 * avec son motif). La plus récente d'abord.
 */
import type { PieceLue } from "@malica/socle/ports/repositories";

export function piecesALire(pieces: readonly PieceLue[]): PieceLue[] {
  return pieces
    .filter((p) => p.status === "capturee" && !p.gardeeLe && !p.lectureRefusee)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}
