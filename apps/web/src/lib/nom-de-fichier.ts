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

/** La longueur d'un nom de fichier remis, extension comprise. */
const LONGUEUR_MAX = 100;

/**
 * Les caractères qu'un système de fichiers refuse. Les noms viennent de
 * pièces utilisateur : les caractères de contrôle et les séparateurs de
 * chemin n'y ont aucune place ; ils sont remplacés, pas supprimés.
 */
function nettoyer(texte: string): string {
  // eslint-disable-next-line no-control-regex
  const interdits = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;
  return texte
    .normalize("NFKC")
    .replace(interdits, "-")
    .replace(/\.{2,}/g, "-")
    .trim();
}

/**
 * Un nom de fichier qu'un système de fichiers accepte, en une passe. Trop
 * long, le nom se coupe AVANT l'extension, qui reste toujours (revue Codex
 * de #146 — tronqué une seconde fois à la remise, le nom d'une pièce perdait
 * son identifiant et son « .pdf »). Appliqué à un nom déjà sûr, il le rend tel
 * quel.
 */
export function nomDeFichierSur(nom: string): string {
  const propre = nettoyer(nom);
  const point = propre.lastIndexOf(".");
  const extension = point > 0 && propre.length - point <= 10 ? propre.slice(point) : "";
  const base = extension ? propre.slice(0, point) : propre;
  return (base.slice(0, LONGUEUR_MAX - extension.length).trim() || "document") + extension;
}

/**
 * « {libellé}_{identifiant}.{extension} » : deux pièces, deux noms. Le
 * libellé seul se raccourcit pour que le nom tienne dans la limite ; le nom
 * rendu est final.
 */
export function nomDeFichierDePiece(
  libelle: string | null,
  pieceId: string,
  typeDeContenu: string,
): string {
  const suffixe = `_${pieceId}.${extensionDuContenu(typeDeContenu)}`;
  const tete = nettoyer(libelle ?? "")
    .slice(0, LONGUEUR_MAX - suffixe.length)
    .trim();
  return `${tete || "document"}${suffixe}`;
}
