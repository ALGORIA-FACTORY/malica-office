/**
 * Où en est le règlement d'une pièce — UNE phrase, pour l'en-tête de la
 * section « Règlement » (maquette « Paiements d'une pièce », validée par
 * Wissem le 25 octobre 2026).
 *
 * Elle se dérive des lignes que la base rend, et de rien d'autre : la somme
 * des règlements vivants (dette éteinte comprise, donc une retenue à la
 * source qualifiée compte), comparée au TTC lu. Les annulations ne comptent
 * pas ; elles vont dans l'historique.
 */
import type { PaiementDUnePiece } from "@malica/socle/ports/repositories";

import { totalDesPaiements } from "@/lib/total-des-paiements";

export type EtatDuReglement =
  | { kind: "rien" }
  | { kind: "non_paye"; depuis: string }
  | { kind: "partiel"; paye: number; reste: number }
  | { kind: "paye"; paye: number }
  | { kind: "a_confirmer"; paye: number }
  | { kind: "illisible" };

export function etatDuReglement(
  ttc: number | null,
  lignes: readonly PaiementDUnePiece[],
): EtatDuReglement {
  const vivants = lignes.filter((l) => !l.eteint);
  if (vivants.length === 0) return { kind: "rien" };
  const nonPaye = vivants.find((l) => l.moyenCode === "non_paye");
  if (nonPaye && vivants.length === 1) return { kind: "non_paye", depuis: nonPaye.createdAt };
  const paye = totalDesPaiements(vivants);
  if (paye === null) return { kind: "illisible" };
  if (ttc === null) return { kind: "a_confirmer", paye };
  if (paye >= ttc) return { kind: "paye", paye };
  return { kind: "partiel", paye, reste: ttc - paye };
}

/** Un règlement annulé, avec ce qui l'a annulé : la ligne d'historique. */
export interface Annule {
  ligne: PaiementDUnePiece;
  le: string | null;
  motifId: string | null;
}

/**
 * L'historique : chaque règlement annulé UNE fois, avec la date et le motif
 * de son annulation — la ligne d'annulation elle-même n'est pas une ligne
 * de plus (« Espèces · Annulé » puis « Espèces · Annulation », relevé le
 * 25 octobre, disaient deux fois la même chose). Le plus récent d'abord.
 */
export function historiqueDuReglement(lignes: readonly PaiementDUnePiece[]): Annule[] {
  return lignes
    .filter((l) => l.eteint && l.annulePaiementId === null)
    .map((l) => {
      const a = lignes.find((x) => x.annulePaiementId === l.id) ?? null;
      return { ligne: l, le: a?.createdAt ?? null, motifId: a?.annulationMotifId ?? null };
    })
    .sort((x, y) => (y.le ?? "").localeCompare(x.le ?? ""));
}
