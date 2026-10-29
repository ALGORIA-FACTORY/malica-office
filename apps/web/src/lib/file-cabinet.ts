/**
 * Ce que la file du cabinet lit dans une pièce — hors de tout écran, pour
 * que plusieurs écrans le lisent pareil et qu'une épreuve le fixe.
 */
import { TON_CABINET, type StatutCabinet, type SuiviDEnvoi } from "@malica/socle/statut-d-envoi";

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

/**
 * Les pièces prises en charge (validées ou forcées) depuis un instant, comptées
 * à la date de la prise en charge, pas à celle de l'envoi : une pièce reçue
 * il y a trois jours et validée ce matin compte aujourd'hui. Une écriture
 * seulement proposée par le Socle n'est pas une prise en charge.
 */
export function prisesEnChargeDepuis(
  pieces: ReadonlyArray<{ suivi: SuiviDEnvoi | null }>,
  depuis: number,
): number {
  return pieces.filter((p) => {
    const s = p.suivi;
    return s?.prise != null && s.priseLe !== null && Date.parse(s.priseLe) >= depuis;
  }).length;
}
