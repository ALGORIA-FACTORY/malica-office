/**
 * Module de capacité « pages du PDF » — retrouver, dans un PDF que Malica a
 * construit, les images de page telles qu'elles y sont enregistrées.
 *
 * ============================================================== POURQUOI
 *
 * Avant de taper « Lire », la personne doit voir le scan FINAL : non pas
 * l'aperçu fugitif de l'appareil photo, mais les octets qui partiront à la
 * lecture. Nos PDF de scan (`buildImagesPdf`) embarquent chaque page comme
 * une image JPEG intacte, flux `DCTDecode`. Il suffit de les découper : pas
 * de moteur PDF, pas de rendu, pas de perte — l'image affichée EST l'image
 * enregistrée.
 *
 * Un PDF qui ne vient pas de nous (déposé depuis un fichier) ne porte pas
 * forcément d'images de ce type : la liste est alors vide, et l'écran
 * retombe sur la visionneuse complète. Ce module n'échoue jamais : il rend
 * ce qu'il trouve.
 */

const CHERCHE = new TextEncoder();
const FILTRE = CHERCHE.encode("/DCTDecode");
const LONGUEUR = CHERCHE.encode("/Length ");
const FLUX = CHERCHE.encode("stream");
const OBJET = CHERCHE.encode(" obj");

function indexDe(
  octets: Uint8Array,
  motif: Uint8Array,
  depuis: number,
  jusqua = octets.length,
): number {
  const fin = Math.min(jusqua, octets.length) - motif.length;
  for (let i = Math.max(0, depuis); i <= fin; i += 1) {
    let k = 0;
    while (k < motif.length && octets[i + k] === motif[k]) k += 1;
    if (k === motif.length) return i;
  }
  return -1;
}

/** Le dernier `motif` qui se termine avant `avant`, ou -1. */
function dernierIndexDe(octets: Uint8Array, motif: Uint8Array, avant: number): number {
  for (let i = Math.min(avant, octets.length) - motif.length; i >= 0; i -= 1) {
    let k = 0;
    while (k < motif.length && octets[i + k] === motif[k]) k += 1;
    if (k === motif.length) return i;
  }
  return -1;
}

/**
 * Les pages JPEG d'un PDF, dans l'ordre du fichier.
 *
 * Chaque image est rendue comme un `Blob` de type `image/jpeg`, prêt pour un
 * `<img>`. Le découpage suit la structure du PDF (`/Length` puis `stream`) :
 * on ne cherche pas des marqueurs JPEG au hasard, qui pourraient tomber au
 * milieu d'une vignette embarquée.
 */
export function pagesJpegDuPdf(pdf: ArrayBuffer | Uint8Array): Blob[] {
  const octets = pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
  const pages: Blob[] = [];
  let curseur = 0;
  for (;;) {
    const filtre = indexDe(octets, FILTRE, curseur);
    if (filtre < 0) break;
    // La longueur se cherche dans le dictionnaire de CET objet — depuis son
    // « n 0 obj » jusqu'à son « stream ». Chercher en arrière à l'aveugle
    // tombait sur le flux de contenu de la page précédente, plus court, et
    // tronquait l'image.
    const objet = dernierIndexDe(octets, OBJET, filtre);
    const debutDict = objet >= 0 ? objet : Math.max(0, filtre - 400);
    const finDict = indexDe(octets, FLUX, filtre);
    if (finDict < 0) break;
    const longueurA = indexDe(octets, LONGUEUR, debutDict, finDict);
    if (longueurA < 0) {
      curseur = finDict + FLUX.length;
      continue;
    }
    let n = 0;
    let i = longueurA + LONGUEUR.length;
    while (i < finDict && octets[i]! >= 0x30 && octets[i]! <= 0x39) {
      n = n * 10 + (octets[i]! - 0x30);
      i += 1;
    }
    // Après « stream » : un retour à la ligne (LF, ou CR LF).
    let debut = finDict + FLUX.length;
    if (octets[debut] === 0x0d) debut += 1;
    if (octets[debut] === 0x0a) debut += 1;
    if (n > 0 && debut + n <= octets.length) {
      pages.push(new Blob([octets.slice(debut, debut + n)], { type: "image/jpeg" }));
    }
    curseur = debut + Math.max(n, 1);
  }
  return pages;
}
