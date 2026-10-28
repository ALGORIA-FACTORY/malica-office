/**
 * La miniature d'une pièce — une petite image de la vraie page, faite une fois.
 *
 * ============================================================== POURQUOI
 *
 * Les listes de la PME et la file du cabinet montrent 20 à 100 pièces. Leur
 * aperçu chargeait les octets COMPLETS de chacune (`/pieces/:id/contenu`, un à
 * trois mégaoctets la photo) : une liste ouverte sur un forfait mobile coûtait
 * jusqu'à des centaines de mégaoctets. Une miniature JPEG de quelques dizaines
 * de kilo-octets montre la même tête de document.
 *
 * ======================================== POURQUOI CÔTÉ SERVEUR, ET UNE FOIS
 *
 * Réduire côté client ne règle rien : il faudrait d'abord TÉLÉCHARGER la pièce
 * entière pour la réduire. Le serveur, lui, a déjà les octets sur son disque,
 * et `@napi-rs/canvas` (déjà dépendance de l'API, pour les bandes de lecture)
 * décode et encode sans rien ajouter. La miniature est faite à la première
 * demande puis gardée à côté de la pièce : les octets d'une pièce sont scellés
 * (`capture_sceller_empreinte`), sa miniature ne change donc jamais.
 *
 * ========================================================== CE QU'ELLE MONTRE
 *
 *   — une photo : elle-même, réduite, et redressée selon son orientation
 *     EXIF — `loadImage` l'applique au décodage (mesuré sur les huit
 *     orientations, voir l'épreuve) ;
 *   — un PDF : sa première page quand cette page EST une image (un scan,
 *     `extrairePagesScannees`, la même extraction que la lecture) ;
 *   — tout le reste (PDF de texte, type inconnu, image illisible) : `null`.
 *     L'écran montre alors la feuille esquissée. Rien n'est inventé : pas de
 *     page dessinée qui passerait pour la pièce.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { extrairePagesScannees } from "./malica/lecture/pdf-image.ts";

/**
 * La boîte où la miniature tient, en pixels. Le plus grand cadre qui la montre
 * est une tuile de la grille « Mon espace » (un tiers d'écran de téléphone,
 * environ 110 × 128 points) : sur un écran à densité 3, 360 × 480 la rend
 * nette. Au-delà, on paierait des octets qu'aucun écran de liste n'affiche.
 */
const BOITE = { largeur: 360, hauteur: 480 } as const;

/** Qualité JPEG (0-100) : la tête d'un document, pas sa lecture. */
const QUALITE = 72;

/**
 * Écart toléré entre la forme de l'image et celle de la page pour dire que
 * l'image EST la page. Un scan la couvre (même forme, aux marges près) ; un
 * logo, presque jamais.
 */
const ECART_DE_FORME = 0.2;

/** L'image source d'un PDF : sa première page, si c'est un scan. */
async function premierePageScannee(octets: Uint8Array): Promise<string | null> {
  const [page] = await extrairePagesScannees(octets, 1);
  if (!page || page.page !== 1) return null;
  const forme = page.largeur / page.hauteur;
  if (Math.abs(forme - page.formatDeLaPage) / page.formatDeLaPage > ECART_DE_FORME) return null;
  return page.dataUrl;
}

/**
 * La miniature JPEG d'une pièce, ou `null` quand son contenu n'en donne pas.
 * Ne lève jamais pour un contenu illisible : une miniature manquante n'est pas
 * une panne, l'écran a sa feuille esquissée.
 */
export async function fabriquerMiniature(octets: Uint8Array, type: string): Promise<Buffer | null> {
  let source: Buffer | string | null = null;
  try {
    if (type.startsWith("image/")) source = Buffer.from(octets);
    else if (type === "application/pdf") source = await premierePageScannee(octets);
    if (!source) return null;

    const image = await loadImage(source);
    if (!image.width || !image.height) return null;
    // Jamais agrandie : une petite photo reste ce qu'elle est.
    const echelle = Math.min(1, BOITE.largeur / image.width, BOITE.hauteur / image.height);
    const largeur = Math.max(1, Math.round(image.width * echelle));
    const hauteur = Math.max(1, Math.round(image.height * echelle));
    const toile = createCanvas(largeur, hauteur);
    const ctx = toile.getContext("2d");
    // Le JPEG n'a pas d'alpha : un PNG transparent se pose sur le blanc du papier.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, largeur, hauteur);
    ctx.drawImage(image, 0, 0, largeur, hauteur);
    return await toile.encode("jpeg", QUALITE);
  } catch {
    return null;
  }
}
