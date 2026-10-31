/**
 * Ce que l'écran dit d'un montant tapé qui ne s'inscrit pas (`refusDeSaisie`,
 * au Socle). Une seule table pour toutes les saisies : le règlement, le stock.
 * Revue de la PR 144 : un bouton grisé sans raison passe pour une panne.
 */
import type { MessageKey } from "@malica/socle/messages";
import { refusDeSaisie } from "@malica/socle/saisie-decimale";

const CLES = {
  illisible: "saisie.refus.illisible",
  negatif: "saisie.refus.negatif",
  trop_precis: "saisie.refus.tropPrecis",
} as const satisfies Record<NonNullable<ReturnType<typeof refusDeSaisie>>, MessageKey>;

/**
 * La phrase à montrer sous une saisie de montant, ou null quand il n'y a rien
 * à dire — champ vide compris : on ne reproche rien à qui n'a encore rien tapé.
 * `negatif` remplace la phrase du refus négatif quand l'écran en a une à lui.
 */
export function phraseDuRefus(
  texte: string,
  decimales: number,
  negatif: MessageKey = CLES.negatif,
): MessageKey | null {
  if (texte.trim() === "") return null;
  const refus = refusDeSaisie(texte, decimales);
  if (refus === null) return null;
  return refus === "negatif" ? negatif : CLES[refus];
}
