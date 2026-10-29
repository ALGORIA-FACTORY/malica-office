/**
 * Ce que la file du cabinet lit dans une pièce — hors de tout écran, pour
 * que plusieurs écrans le lisent pareil et qu'une épreuve le fixe.
 */
import { TON_CABINET, type StatutCabinet } from "@malica/socle/statut-d-envoi";

import type { Tone } from "@/components/malica/office-ui";
import { FEU_DU_TON } from "@/lib/statut";

/** Le feu d'un statut du cabinet : ambre à vous, bleu chez le client, vert pris en charge. */
export function feuDuStatut(statut: StatutCabinet): Tone {
  return FEU_DU_TON[TON_CABINET[statut]];
}

const JOUR_MS = 86_400_000;

/** L'attente d'une pièce, en jours entiers depuis son dépôt. Jamais négative. */
export function joursDAttente(createdAt: string, maintenant = Date.now()): number {
  const depuis = new Date(createdAt).getTime();
  if (!Number.isFinite(depuis)) return 0;
  return Math.max(0, Math.floor((maintenant - depuis) / JOUR_MS));
}
