/**
 * Les faits d'une pièce, tels qu'un libellé les demande.
 *
 * Le socle sait COMPOSER un libellé ; il ne connaît pas le contrat de lecture.
 * Cet adaptateur fait le pont, et il ne fait que cela : il choisit quelle
 * référence porte le numéro du document, et rien de plus.
 */

import type { ExtractV1 } from "../socle/contracts/extract.v1";
import { nomDeLaNature, type FaitsDuLibelle } from "../socle/engines/libelle";

/**
 * Les clés où un numéro de document se trouve, par ordre de préférence.
 *
 * Ce n'est pas un référentiel réglementaire : c'est le vocabulaire de nos
 * propres lectures. Une clé inconnue n'est pas perdue pour autant — à défaut,
 * on prend la première référence rendue, ce qui vaut mieux que rien.
 */
const CLES_DE_REFERENCE = ["invoice_no", "document_no", "numero", "reference"];

export function referenceDuDocument(
  references: Readonly<Record<string, string>> | undefined,
): string | null {
  if (!references) return null;
  for (const cle of CLES_DE_REFERENCE) {
    const valeur = references[cle]?.trim();
    if (valeur) return valeur;
  }
  const premiere = Object.values(references)
    .map((v) => v.trim())
    .find((v) => v.length > 0);
  return premiere ?? null;
}

/** Les faits du libellé d'une pièce lue. */
export function faitsDuLibelle(extract: ExtractV1): FaitsDuLibelle {
  return {
    nature: nomDeLaNature(extract.document_kind),
    contrepartie: extract.issuer,
    reference: referenceDuDocument(extract.references),
    date: extract.document_date,
  };
}
