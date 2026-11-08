/**
 * Les étapes montrées pendant une lecture (planche 11, 7 novembre 2026) — une
 * activité, jamais un résultat : l'étape avance avec le temps écoulé depuis
 * la demande, et la dernière tient jusqu'à la fin de la lecture.
 */
import type { MessageKey } from "@/i18n";

export const ETAPES_DE_LECTURE: readonly MessageKey[] = [
  "pme.lecture.pas.fournisseur",
  "pme.lecture.pas.matricule",
  "pme.lecture.pas.lignes",
  "pme.lecture.pas.recompte",
  "pme.lecture.pas.lettres",
];

/** Une étape toutes les quatre secondes : la lecture dure vingt à trente secondes. */
const DUREE_D_UNE_ETAPE_MS = 4_000;

/** L'étape montrée, d'après le temps écoulé depuis la demande. */
export function etapeMontree(demandeLe: string | null, maintenant: number): number {
  const debut = demandeLe ? Date.parse(demandeLe) : Number.NaN;
  if (!Number.isFinite(debut)) return 0;
  const n = Math.floor(Math.max(0, maintenant - debut) / DUREE_D_UNE_ETAPE_MS);
  return Math.min(ETAPES_DE_LECTURE.length - 1, n);
}
