/**
 * Une lecture minimale d'une pièce d'essai, par la vraie porte.
 *
 * Depuis le 3 novembre 2026, une pièce non lue ne part pas au cabinet
 * (`une_piece_non_lue_ne_part_pas`). Les épreuves qui transmettent une pièce
 * la lisent d'abord, comme la personne le ferait : `capture_read_persist`,
 * sous son identité, avec un plan d'un seul jeton et sans aucune donnée
 * réelle.
 */
import type { Requete } from "./db.ts";

/** Un plan d'un jeton : de quoi faire exister une lecture, sans rien prétendre. */
const PLAN_MINIMAL = JSON.stringify([
  { page: 1, ordinal: 0, text: "TOTAL", x0: 0, y0: 0, x1: 1, y1: 1 },
]);

/**
 * Lit la pièce sous l'identité portée par `db`. Ce que la lecture a extrait
 * est une facture d'achat, sauf à le dire autrement (un type, une référence).
 */
export async function lireLaPieceDEssai(
  db: Requete,
  pieceId: string,
  extraction: Readonly<Record<string, unknown>> = { document_kind: "facture_achat" },
): Promise<void> {
  await db.query(
    `select public.capture_read_persist($1, $2::jsonb, 'extract.v1', $3::jsonb,
                                         '[]'::jsonb, '[]'::jsonb)`,
    [pieceId, PLAN_MINIMAL, JSON.stringify(extraction)],
  );
}
