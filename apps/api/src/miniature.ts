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
 * ============================================ CE QUI ENTRE DANS LE DÉCODEUR
 *
 * Les octets d'une pièce viennent du client, et son `content_type` aussi. Le
 * décodeur (Skia) n'est pas une frontière de confiance : relu le 29 octobre
 * 2026, une SVG de 70 octets déclarant 200 000 × 200 000 le faisait ABATTRE
 * le processus (`tryAllocPixels`, une assertion fatale, que nul `try` ne
 * rattrape), et une SVG peut désigner un fichier local par `<image href>`.
 * D'où deux portes, avant tout décodage :
 *
 *   — le format se lit dans la SIGNATURE des octets, jamais dans le type
 *     déclaré : JPEG, PNG, WebP, et PDF. Rien d'autre n'est décodé ;
 *   — les dimensions se lisent dans l'EN-TÊTE, et une image au-delà de
 *     `PLAFOND_PIXELS` n'est pas décodée. Pour un PDF, pdf.js reçoit le même
 *     plafond (`maxImageSize`) : une image qui le dépasse n'est pas dessinée,
 *     le reste de la page l'est.
 *
 * Un PDF se rend dans un FIL À PART (`miniature-pdf.ts`), borné en temps et en
 * mémoire (`limitesDuRenduPdf`) : pdf.js travaille en microtâches, et aucune
 * minuterie du fil de l'API ne l'arrêterait. Il ne lit ni police système ni
 * adresse fournie par le PDF : polices standard, CMaps et décodeurs viennent
 * du paquet installé.
 *
 * ========================================================== CE QU'ELLE MONTRE
 *
 *   — une photo : elle-même, réduite, et redressée selon son orientation
 *     EXIF — `loadImage` l'applique au décodage (mesuré sur les huit
 *     orientations, voir l'épreuve) ;
 *   — un PDF, QUEL QU'IL SOIT : sa première page, rendue par pdf.js sur
 *     `@napi-rs/canvas` directement à la taille de la boîte — un scan, une
 *     page de texte, un scan en plusieurs bandes. (Jusqu'au 29 octobre 2026,
 *     seule une page faite d'UNE image avait sa miniature ; un PDF de texte de
 *     4,7 Mo rendait 204 sur staging. Le rendu est aussi plus rapide que
 *     l'ancienne extraction : 0,75 s contre 1,7 s pour un scan A4 à 300 dpi.)
 *   — rien (`null`), PAR NATURE : format refusé, image trop grande, PDF
 *     chiffré, cassé ou sans page, ou PDF qui dépasse ses bornes de rendu.
 *     Ce constat est durable : le serveur le garde.
 *
 * Un échec de décodage, lui, LÈVE : il peut être passager (mémoire, disque),
 * et l'appelant ne doit pas le figer en « pas de miniature ».
 */
import { Worker } from "node:worker_threads";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { DemandeDeRendu, RenduDePage } from "./miniature-pdf.ts";

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
 * Le plus grand nombre de pixels qu'on accepte de décoder : 50 mégapixels,
 * la photo d'un téléphone haut de gamme (200 Mo en mémoire une fois décodée).
 * Au-delà, la pièce garde sa feuille esquissée — la pièce elle-même reste
 * entière, seule sa miniature n'est pas faite.
 */
const PLAFOND_PIXELS = 50_000_000;

type Format = "jpeg" | "png" | "webp" | "pdf";

const commencePar = (o: Uint8Array, signature: readonly number[], depuis = 0) =>
  signature.every((b, i) => o[depuis + i] === b);
const ascii = (texte: string) => [...texte].map((c) => c.charCodeAt(0));

/** Le format, lu dans les octets — jamais dans le type que le client déclare. */
function formatDe(o: Uint8Array): Format | null {
  if (commencePar(o, [0xff, 0xd8, 0xff])) return "jpeg";
  if (commencePar(o, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (commencePar(o, ascii("RIFF")) && commencePar(o, ascii("WEBP"), 8)) return "webp";
  if (commencePar(o, ascii("%PDF-"))) return "pdf";
  return null;
}

/**
 * Largeur et hauteur annoncées par l'en-tête, sans rien décoder ; `null`
 * quand l'en-tête ne les dit pas (et l'image n'est alors pas décodée).
 */
function dimensionsDe(
  o: Uint8Array,
  format: Exclude<Format, "pdf">,
): { largeur: number; hauteur: number } | null {
  const vue = new DataView(o.buffer, o.byteOffset, o.byteLength);
  const lire = (lecture: () => number) => {
    try {
      return lecture();
    } catch {
      return null;
    }
  };
  if (format === "png") {
    // IHDR est toujours le premier segment : largeur et hauteur en 16 et 20.
    if (!commencePar(o, ascii("IHDR"), 12)) return null;
    const l = lire(() => vue.getUint32(16));
    const h = lire(() => vue.getUint32(20));
    return l && h ? { largeur: l, hauteur: h } : null;
  }
  if (format === "webp") {
    const morceau = String.fromCharCode(...o.subarray(12, 16));
    if (morceau === "VP8 ") {
      const l = lire(() => vue.getUint16(26, true) & 0x3fff);
      const h = lire(() => vue.getUint16(28, true) & 0x3fff);
      return l && h ? { largeur: l, hauteur: h } : null;
    }
    if (morceau === "VP8L") {
      const b = lire(() => vue.getUint32(21, true));
      return b === null ? null : { largeur: (b & 0x3fff) + 1, hauteur: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (morceau === "VP8X") {
      const l = lire(() => vue.getUint16(24, true) + (vue.getUint8(26) << 16) + 1);
      const h = lire(() => vue.getUint16(27, true) + (vue.getUint8(29) << 16) + 1);
      return l && h ? { largeur: l, hauteur: h } : null;
    }
    return null;
  }
  // JPEG : on suit les segments jusqu'au premier SOFn, qui porte les dimensions.
  let i = 2;
  while (i + 9 < o.length) {
    if (o[i] !== 0xff) return null;
    const marque = o[i + 1]!;
    if (marque === 0xff) {
      i += 1;
      continue;
    }
    if (marque === 0xd8 || marque === 0x01 || (marque >= 0xd0 && marque <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marque === 0xda || marque === 0xd9) return null;
    const longueur = vue.getUint16(i + 2);
    const estSof = marque >= 0xc0 && marque <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marque);
    if (estSof) {
      const h = vue.getUint16(i + 5);
      const l = vue.getUint16(i + 7);
      return l && h ? { largeur: l, hauteur: h } : null;
    }
    i += 2 + longueur;
  }
  return null;
}

/**
 * Les bornes du rendu d'un PDF, dans un objet : une épreuve les resserre pour
 * mettre en scène un PDF trop lourd sans attendre le vrai délai.
 *
 *   — `delaiMs` : au-delà, le fil est terminé. Une page de facture se rend en
 *     quelques centaines de millisecondes ; quinze secondes, c'est un PDF
 *     construit pour ne jamais finir.
 *   — `memoireMo` : le tas JavaScript du fil, où pdf.js tient ce qu'il lit
 *     du PDF. Les pixels des images vivent hors de ce tas : eux, c'est
 *     `PLAFOND_PIXELS` qui les borne.
 */
export const limitesDuRenduPdf = { delaiMs: 15_000, memoireMo: 512 };

/**
 * Les premières pages d'un PDF, rendues chacune dans la boîte
 * (`miniature-pdf.ts`, dans un fil à part) : la miniature en demande une, la
 * lecture qui relit une page en image en demande plusieurs (`pdf-image.ts`).
 * `null` quand il n'en a pas à montrer, par nature — chiffré, cassé, sans
 * page — ou quand il dépasse ses bornes (`limitesDuRenduPdf`) : le même PDF
 * les dépasserait encore à la prochaine demande. Lève sur toute autre erreur
 * du rendu.
 */
export function pagesDuPdf(
  octets: Uint8Array,
  rendu: Pick<DemandeDeRendu, "boite" | "qualite" | "pages">,
): Promise<Buffer[] | null> {
  // Une COPIE, transférée au fil : l'appelant garde ses octets intacts.
  const copie = new ArrayBuffer(octets.byteLength);
  new Uint8Array(copie).set(octets);
  const demande: DemandeDeRendu = {
    octets: new Uint8Array(copie),
    plafondPixels: PLAFOND_PIXELS,
    ...rendu,
  };
  return new Promise((resoudre, rejeter) => {
    const fil = new Worker(new URL("./miniature-pdf.ts", import.meta.url), {
      workerData: demande,
      transferList: [copie],
      resourceLimits: { maxOldGenerationSizeMb: limitesDuRenduPdf.memoireMo },
    });
    let reglee = false;
    const regler = (suite: () => void) => {
      if (reglee) return;
      reglee = true;
      clearTimeout(minuterie);
      void fil.terminate();
      suite();
    };
    const minuterie = setTimeout(() => regler(() => resoudre(null)), limitesDuRenduPdf.delaiMs);
    fil.once("message", ({ jpegs }: RenduDePage) =>
      regler(() => resoudre(jpegs.length > 0 ? jpegs.map((j) => Buffer.from(j)) : null)),
    );
    fil.once("error", (erreur: Error & { code?: string }) =>
      regler(() => (erreur.code === "ERR_WORKER_OUT_OF_MEMORY" ? resoudre(null) : rejeter(erreur))),
    );
    fil.once("exit", (code) =>
      regler(() => rejeter(new Error(`rendu du PDF interrompu (code ${code})`))),
    );
  });
}

/**
 * La miniature JPEG d'une pièce ; `null` quand son contenu n'en donne pas, par
 * nature (voir l'en-tête). Lève sur un échec de décodage : à l'appelant de ne
 * pas le garder pour définitif.
 */
export async function fabriquerMiniature(octets: Uint8Array): Promise<Buffer | null> {
  const format = formatDe(octets);
  if (!format) return null;
  // Un PDF sort du fil déjà rendu à la taille de la boîte.
  if (format === "pdf")
    return (await pagesDuPdf(octets, { boite: BOITE, qualite: QUALITE, pages: 1 }))?.[0] ?? null;

  const taille = dimensionsDe(octets, format);
  if (!taille || taille.largeur * taille.hauteur > PLAFOND_PIXELS) return null;

  const image = await loadImage(Buffer.from(octets));
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
}

/** Le côté d'un portrait, en pixels : une pastille de 36 px, vue à 3×, sans plus. */
const COTE_DU_PORTRAIT = 256;
const QUALITE_DU_PORTRAIT = 82;

/**
 * Le portrait d'une personne : un carré JPEG, recadré au centre, ré-encodé.
 *
 * Même porte que la miniature (signature des octets, dimensions de l'en-tête,
 * plafond de pixels), et un seul format admis en entrée : JPEG, PNG, WebP —
 * jamais un PDF. Le ré-encodage n'est pas un confort : il ne garde ni les
 * métadonnées (position GPS d'une photo de téléphone, appareil, date) ni rien
 * qu'un fichier forgé y cacherait ; les octets servis sont ceux que CE code a
 * écrits. `null` quand les octets ne sont pas une image admise.
 */
export async function fabriquerPortrait(octets: Uint8Array): Promise<Buffer | null> {
  const format = formatDe(octets);
  if (!format || format === "pdf") return null;
  const taille = dimensionsDe(octets, format);
  if (!taille || taille.largeur * taille.hauteur > PLAFOND_PIXELS) return null;

  const image = await loadImage(Buffer.from(octets));
  if (!image.width || !image.height) return null;
  const carre = Math.min(image.width, image.height);
  const toile = createCanvas(COTE_DU_PORTRAIT, COTE_DU_PORTRAIT);
  const ctx = toile.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, COTE_DU_PORTRAIT, COTE_DU_PORTRAIT);
  ctx.drawImage(
    image,
    (image.width - carre) / 2,
    (image.height - carre) / 2,
    carre,
    carre,
    0,
    0,
    COTE_DU_PORTRAIT,
    COTE_DU_PORTRAIT,
  );
  return await toile.encode("jpeg", QUALITE_DU_PORTRAIT);
}

/**
 * La fabrique, dans un objet : `stockage.ts` passe par lui, et une épreuve
 * peut la ralentir (`mock.method`) pour éprouver une suppression pendant la
 * fabrication — ce que deux appels réels ne savent pas mettre en scène.
 */
export const fabrique = { miniature: fabriquerMiniature };
