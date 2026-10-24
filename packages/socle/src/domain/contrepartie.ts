/**
 * La contrepartie d'une pièce : le tiers avec qui le dossier traite.
 *
 * Elle vivait dans le cas d'usage du libellé (`use-cases/libelle-de-piece.ts`),
 * et le moteur d'équilibre l'importait de là : un moteur dépendait d'un cas
 * d'usage, à rebours des couches. C'est une propriété de la pièce, pas d'un
 * libellé — elle vit au domaine, et les deux la lisent ici.
 */

/** Sur une vente, l'émetteur est le dossier lui-même, jamais le client. */
export function contrepartieDuDocument(extract: {
  document_kind?: string | null;
  issuer?: string;
  references?: Readonly<Record<string, string>>;
}): string | null {
  if (extract.document_kind === "facture_achat") return extract.issuer?.trim() || null;
  return extract.references?.["customer_name"]?.trim() || null;
}
