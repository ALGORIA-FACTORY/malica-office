/**
 * Le nom d'un fichier remis — un seul endroit.
 *
 * Trois écrans remettaient une pièce, chacun avec son nom : « {société}
 * {jour}.pdf » dans Mon espace, « {référence}.pdf » sur la fiche du cabinet,
 * « {type}_{id}.pdf » pour un document joint ; l'archive comptable avait son
 * propre nettoyage. Deux pièces de même société, même jour et même type
 * prenaient le même nom, et dans la coque native la seconde écrasait la
 * première (revue Codex de #146). Le nom d'une pièce porte toujours son
 * identifiant.
 */

/** L'extension d'après le type de contenu ; `bin` si le type est inconnu. */
export function extensionDuContenu(type: string): string {
  const types: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/tiff": "tiff",
    "text/plain": "txt",
  };
  return types[type.split(";")[0]!.trim().toLowerCase()] ?? "bin";
}

/**
 * Un nom qu'un système de fichiers accepte. Les noms viennent de pièces
 * utilisateur : les caractères de contrôle et les séparateurs de chemin n'y
 * ont aucune place ; ils sont remplacés, pas supprimés.
 */
export function nomSur(texte: string): string {
  // eslint-disable-next-line no-control-regex
  const interdits = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;
  return (
    texte
      .normalize("NFKC")
      .replace(interdits, "-")
      .replace(/\.{2,}/g, "-")
      .trim()
      .slice(0, 100) || "document"
  );
}

/** « {libellé}_{identifiant}.{extension} » : deux pièces, deux noms. */
export function nomDeFichierDePiece(
  libelle: string | null,
  pieceId: string,
  typeDeContenu: string,
): string {
  return `${nomSur(libelle ?? "document")}_${pieceId}.${extensionDuContenu(typeDeContenu)}`;
}
