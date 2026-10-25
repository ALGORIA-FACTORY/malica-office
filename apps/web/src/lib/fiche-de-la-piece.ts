/**
 * Ce que la fiche d'une pièce (côté PME) affirme, dérivé en un seul endroit
 * pour qu'elle ne se contredise jamais.
 *
 * 25 octobre 2026, staging, pièce « COMPTOIR » : quatre écritures de
 * RÈGLEMENT (deux paiements, deux annulations), aucune écriture de pièce. La
 * fiche disait « Écriture comptabilisée » pendant que le parcours disait
 * « Étape 2 · Lue », et la question du montant avait disparu : la personne
 * ne pouvait plus avancer. N'importe quelle écriture inscrite passait pour
 * celle de la pièce.
 */
import type { Ecriture, PieceStatus, Visibility } from "@malica/socle/ports/repositories";

/**
 * L'écriture de la pièce, et elle seule : la vivante (inscrite, de nature
 * « pièce », ni contre-passation ni contre-passée). Un règlement ou une
 * écriture annulée ne comptabilise pas la pièce.
 */
export function ecritureDeLaPiece(ecritures: readonly Ecriture[] | undefined): Ecriture | null {
  return (ecritures ?? []).find((e) => e.vivante) ?? null;
}

/** Le rang de chaque statut dans le parcours : Reçue 1 … Vue 5. */
const RANG_DU_STATUT: Readonly<Record<PieceStatus, number>> = {
  capturee: 1,
  lue: 2,
  proposee: 3,
  comptabilisee: 4,
  supervisee: 5,
  retournee: 3,
};

/** Le rang à partir duquel une pièce est comptée (l'étape « Comptée »). */
export const RANG_COMPTEE = RANG_DU_STATUT.comptabilisee;

export interface AvancementDeLaPiece {
  /** L'étape atteinte du parcours. */
  atteint: number;
  /** La pièce est comptabilisée : vrai si et seulement si `atteint >= RANG_COMPTEE`. */
  comptee: boolean;
}

/**
 * L'avancement, UNE source pour le parcours et pour « comptée ».
 *
 * Comptée par son écriture vivante, OU par son statut — l'écriture peut
 * tarder d'une requête, et une pièce comptée ne doit jamais reposer la
 * question du montant. Une écriture vivante pousse le parcours au moins à
 * l'étape « Comptée » : « Étape 2 » et « Écriture comptabilisée » ne peuvent
 * plus s'afficher ensemble.
 */
export function avancementDeLaPiece(
  status: PieceStatus,
  ecriture: Ecriture | null,
): AvancementDeLaPiece {
  const rang = RANG_DU_STATUT[status] ?? 1;
  const atteint = ecriture ? Math.max(rang, RANG_COMPTEE) : rang;
  return { atteint, comptee: atteint >= RANG_COMPTEE };
}

/**
 * La pièce est entre les mains du cabinet : partagée. C'est là seulement
 * qu'une suppression se DEMANDE — `piece_demander` refuse toute autre pièce,
 * et un bouton qui ne peut qu'échouer ne se montre pas.
 */
export function partageeAvecLeCabinet(vis: Visibility): boolean {
  return vis === "partage";
}

/**
 * La note sur une demande de suppression, à montrer ou non.
 *
 * Une pièce rappelée au privé peut garder une vieille demande en attente :
 * ce n'est plus à la comptabilité d'accorder quoi que ce soit, et la note
 * cacherait le « Supprimer » ordinaire. Hors partage, rien.
 */
export function noteDeSuppression(
  fait: string | null,
  vis: Visibility,
): "demandee" | "refusee" | null {
  if (!partageeAvecLeCabinet(vis)) return null;
  return fait === "demandee" || fait === "refusee" ? fait : null;
}
