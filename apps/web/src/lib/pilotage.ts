/**
 * Ce que le pilotage déduit sans rien décider : l'état d'un collaborateur
 * face à la capacité réglée par le cabinet, la santé d'un mandat face au
 * taux de retour moyen du cabinet. Aucun seuil écrit ici : la capacité est
 * un réglage, la moyenne est celle des données.
 */
import type { MessageKey } from "@/i18n";
import type { ClientStats } from "@/verticals/regalica-office/ports/repositories";

/** L'état d'un collaborateur, déduit de sa charge et de la capacité réglée par le cabinet. */
export function etatDeCharge(dossiers: number, capacite: number): MessageKey {
  if (dossiers === 0) return "cab.pil.etat.aucun";
  if (dossiers > capacite) return "cab.pil.etat.surcharge";
  if (dossiers === capacite) return "cab.pil.etat.capacite";
  return "cab.pil.etat.disponible";
}

/** La santé d'un mandat : sans retour, ou comparée au taux moyen du cabinet. */
export function santeDuMandat(taux: number | null, tauxCabinet: number): MessageKey {
  if (taux === null || taux === 0) return "cab.pil.sante.sans";
  return taux > tauxCabinet ? "cab.pil.sante.suivre" : "cab.pil.sante.saine";
}

/** Le taux de retour d'un mandat, ou rien s'il n'a pas de pièce. */
export function tauxDeRetour(
  s: Pick<ClientStats, "pieces" | "retournees"> | undefined,
): number | null {
  if (!s || s.pieces === 0) return null;
  return s.retournees / s.pieces;
}
