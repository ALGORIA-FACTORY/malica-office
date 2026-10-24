/**
 * Les faits d'une pièce, tels qu'un libellé les demande.
 *
 * Le socle sait COMPOSER un libellé ; il ne connaît pas le contrat de lecture.
 * Cet adaptateur fait le pont, et il ne fait que cela : il choisit quelle
 * référence porte le numéro du document, et rien de plus.
 */

import type { ExtractV1 } from "../contracts/extract.v1.ts";
import { nomDeLaNature, type FaitsDuLibelle } from "../engines/libelle.ts";

/** Seules les clés désignant explicitement le numéro du document sont retenues. */
const CLES_DE_REFERENCE = ["invoice_no", "document_no", "numero", "reference"];

export function referenceDuDocument(
  references: Readonly<Record<string, string>> | undefined,
): string | null {
  if (!references) return null;
  for (const cle of CLES_DE_REFERENCE) {
    const valeur = references[cle]?.trim();
    if (valeur) return valeur;
  }
  return null;
}

/** Les faits du libellé d'une pièce lue. */
export function faitsDuLibelle(extract: ExtractV1): FaitsDuLibelle {
  return {
    nature: nomDeLaNature(extract.document_kind),
    contrepartie: contrepartieDuDocument(extract),
    reference: referenceDuDocument(extract.references),
    date: extract.document_date,
  };
}

/** Sur une vente, l'émetteur est le dossier lui-même, jamais le client. */
export function contrepartieDuDocument(extract: {
  document_kind?: string | null;
  issuer?: string;
  references?: Readonly<Record<string, string>>;
}): string | null {
  if (extract.document_kind === "facture_achat") return extract.issuer?.trim() || null;
  return extract.references?.["customer_name"]?.trim() || null;
}
