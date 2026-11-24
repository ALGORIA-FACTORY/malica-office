/**
 * L'ordre de la Bibliothèque : par mois, le plus récent devant.
 *
 * Une règle, deux lecteurs : la Bibliothèque groupe ses pièces par mois, et la
 * pièce ouverte au bureau passe à la suivante (J) ou à la précédente (K) dans ce
 * même ordre. Pur : ni réseau ni écran.
 */
import type { PieceLue } from "@malica/socle/ports/repositories";

import { moisDeLaPiece } from "@/lib/dossiers";
import { piecesCompteesDe } from "@/lib/lecture";

type PieceDatee = Pick<PieceLue, "id" | "dateDocument" | "createdAt">;

/** Les pièces par mois (`AAAA-MM`), le plus récent devant ; dans un mois, l'ordre reçu. */
export function groupesParMois<P extends PieceDatee>(pieces: readonly P[]): Array<[string, P[]]> {
  const carte = new Map<string, P[]>();
  for (const p of pieces) {
    const cle = moisDeLaPiece(p);
    const groupe = carte.get(cle);
    if (groupe) groupe.push(p);
    else carte.set(cle, [p]);
  }
  return [...carte].sort(([a], [b]) => b.localeCompare(a));
}

export interface PlaceDansLaListe {
  /** Le rang de la pièce, à partir de 1. */
  rang: number;
  total: number;
  precedente: string | null;
  suivante: string | null;
}

/**
 * Les pièces que la Bibliothèque montre d'un lot : ni l'espace privé, ni un document
 * joint ou un reçu, qui ne sont pas une pièce de plus (G8, 13 novembre 2026).
 */
export function piecesDeLaBibliotheque(lot: readonly PieceLue[]): PieceLue[] {
  return piecesCompteesDe(lot.filter((p) => p.vis !== "personnel"));
}

/** La touche qui passe d'une pièce à l'autre, au bureau : J la suivante, K la précédente. */
export function toucheDeNavigation(e: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
}): "suivante" | "precedente" | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  // Une saisie en cours garde ses lettres : un « j » tapé dans un champ n'est pas un geste.
  const cible = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (cible?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible?.tagName ?? "")) {
    return null;
  }
  const touche = e.key.toLowerCase();
  return touche === "j" ? "suivante" : touche === "k" ? "precedente" : null;
}

/** Où est une pièce dans l'ordre de la Bibliothèque ; `null` si elle n'y est pas. */
export function placeDansLaBibliotheque(
  pieces: readonly PieceDatee[],
  pieceId: string,
): PlaceDansLaListe | null {
  const ordre = groupesParMois(pieces).flatMap(([, ps]) => ps);
  const i = ordre.findIndex((p) => p.id === pieceId);
  if (i < 0) return null;
  return {
    rang: i + 1,
    total: ordre.length,
    precedente: ordre[i - 1]?.id ?? null,
    suivante: ordre[i + 1]?.id ?? null,
  };
}
