/**
 * Ce que la file du cabinet lit dans une pièce — hors de tout écran, pour
 * que plusieurs écrans le lisent pareil et qu'une épreuve le fixe.
 */
import type { PieceStatus } from "@regalica/socle/ports/repositories";

/** Le ton d'un statut : ce qui attend un geste est or, ce qui est réglé est vert. */
export function toneForStatus(status: PieceStatus): "ok" | "warn" | "stop" | "neutral" {
  if (status === "supervisee") return "ok";
  if (status === "retournee") return "stop";
  if (status === "comptabilisee") return "warn";
  return "neutral";
}

const JOUR_MS = 86_400_000;

/** L'attente d'une pièce, en jours entiers depuis son dépôt. Jamais négative. */
export function joursDAttente(createdAt: string, maintenant = Date.now()): number {
  const depuis = new Date(createdAt).getTime();
  if (!Number.isFinite(depuis)) return 0;
  return Math.max(0, Math.floor((maintenant - depuis) / JOUR_MS));
}
