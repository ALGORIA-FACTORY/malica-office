/**
 * Le rendu des premières pages d'un PDF, dans un fil à part.
 *
 * `miniature.ts` n'en importe que les types : il lance ce fichier comme
 * `Worker`, une fois par rendu (la miniature, ou les pages qu'une lecture
 * relit en image), et le termine. Pourquoi un fil, et pas un simple appel :
 * pdf.js, sous Node, fait tout son travail (lecture, décodage, dessin) dans
 * des microtâches du fil qui l'appelle. Une minuterie n'y a jamais la main :
 * un PDF pathologique (des millions d'opérations, une boucle de formes)
 * tiendrait l'API entière aussi longtemps qu'il le voudrait. Un fil, lui, se
 * TERMINE de l'extérieur, et sa mémoire JavaScript se borne
 * (`resourceLimits`).
 *
 * Il reçoit les octets et les limites (`workerData`), et répond un seul
 * message : `{ jpegs }`, une image par page rendue, vide quand le PDF n'a pas
 * de page à montrer, par nature (chiffré, cassé, sans page). Toute autre erreur LÈVE,
 * et l'appelant la tient pour passagère.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { createCanvas } from "@napi-rs/canvas";
import {
  getDocument,
  ImageKind,
  InvalidPDFException,
  PasswordException,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

export interface DemandeDeRendu {
  octets: Uint8Array;
  boite: { largeur: number; hauteur: number };
  /** Au-delà, pdf.js ne décode pas une image (`maxImageSize`). */
  plafondPixels: number;
  qualite: number;
  /** Le nombre de premières pages à rendre : une pour la miniature. */
  pages: number;
}

export interface RenduDePage {
  /** Une image par page rendue, dans l'ordre ; vide quand le PDF n'en a pas, par nature. */
  jpegs: Uint8Array[];
}

/**
 * Les données que pdf.js charge pour dessiner — polices standard (un PDF qui
 * nomme Helvetica sans l'embarquer), CMaps, profils ICC, décodeurs wasm (JPX,
 * JBIG2) — se lisent dans le paquet installé, sur le disque. Jamais depuis
 * une adresse que le PDF ou le réseau fournirait.
 */
const paquet = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
// pdf.js demands a trailing "/" (not path.sep: on Windows it is "\" and every page fails);
// it then reads with fs.readFile, which takes a Windows path ending in "/".
const dossier = (nom: string) => `${path.join(paquet, nom)}/`;

interface ImageDecodee {
  data?: Uint8Array | Uint8ClampedArray;
  width?: number;
  height?: number;
  kind?: number;
}

/**
 * pdf.js 6 colle une image RGB sur la toile par bandes de 16 lignes, et sa
 * conversion RGB → RGBA (`convertRGBToRGBA`) reparcourt, à chaque bande, tout
 * ce qui la précède : son coût croît comme le CARRÉ de la hauteur. Mesuré le
 * 29 octobre 2026 : un scan A4 à 300 dpi (2 480 × 3 508) y passait 3,1 s, sur
 * 3,4 s de rendu. Une image déjà RGBA prend l'autre chemin, une simple copie
 * par bande. Chaque image RGB est donc élargie en RGBA une fois, en temps
 * linéaire, au moment où pdf.js la reçoit du décodeur (`resolve`, l'entrée
 * publique de ses objets), avant qu'il ne la dessine.
 */
function elargirLesImagesRgb(objets: PDFPageProxy["objs"]): void {
  const recevoir = objets.resolve.bind(objets);
  objets.resolve = (id: string, donnee?: unknown) => {
    const image = donnee as ImageDecodee | null | undefined;
    if (image?.kind === ImageKind.RGB_24BPP && image.data && image.width && image.height) {
      const pixels = image.width * image.height;
      const rgb = image.data;
      const rgba = new Uint8ClampedArray(pixels * 4);
      for (let p = 0, s = 0, d = 0; p < pixels; p += 1, s += 3, d += 4) {
        rgba[d] = rgb[s]!;
        rgba[d + 1] = rgb[s + 1]!;
        rgba[d + 2] = rgb[s + 2]!;
        rgba[d + 3] = 255;
      }
      image.data = rgba;
      image.kind = ImageKind.RGBA_32BPP;
    }
    recevoir(id, donnee);
  };
}

async function rendreUnePage(
  page: PDFPageProxy,
  boite: DemandeDeRendu["boite"],
  qualite: number,
): Promise<Uint8Array | null> {
  // La taille de la page à l'échelle 1, rotation comprise ; puis l'échelle
  // qui la fait tenir dans la boîte. Jamais plus grand que la boîte : on ne
  // dessine pas une page de 14 400 points pour la réduire ensuite.
  const naturelle = page.getViewport({ scale: 1 });
  if (!(naturelle.width > 0 && naturelle.height > 0)) return null;
  const echelle = Math.min(boite.largeur / naturelle.width, boite.hauteur / naturelle.height);
  const vue = page.getViewport({ scale: echelle });
  const largeur = Math.max(1, Math.min(boite.largeur, Math.round(vue.width)));
  const hauteur = Math.max(1, Math.min(boite.hauteur, Math.round(vue.height)));
  // Une image partagée entre pages vit dans les objets communs.
  elargirLesImagesRgb(page.objs);
  elargirLesImagesRgb(page.commonObjs);
  const toile = createCanvas(largeur, hauteur);
  // pdf.js pose d'abord la page sur du blanc (le JPEG n'a pas d'alpha).
  await page.render({
    // La toile de @napi-rs/canvas n'est pas celle du DOM, mais c'est celle
    // que pdf.js emploie lui-même sous Node (`NodeCanvasFactory`).
    canvas: toile as unknown as Parameters<typeof page.render>[0]["canvas"],
    viewport: vue,
  }).promise;
  return new Uint8Array(await toile.encode("jpeg", qualite));
}

async function rendre({
  octets,
  boite,
  plafondPixels,
  qualite,
  pages,
}: DemandeDeRendu): Promise<Uint8Array[]> {
  const tache = getDocument({
    data: octets,
    maxImageSize: plafondPixels,
    // Aucune police système, aucune police chargée par le navigateur : les
    // glyphes se dessinent en tracés, depuis le PDF ou les polices standard.
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    standardFontDataUrl: dossier("standard_fonts"),
    cMapUrl: dossier("cmaps"),
    iccUrl: dossier("iccs"),
    wasmUrl: dossier("wasm"),
    verbosity: 0,
  });
  try {
    const doc = await tache.promise.catch((erreur: unknown) => {
      // Chiffré, ou pas un PDF qu'on sache relire : un constat, pas une panne.
      if (erreur instanceof PasswordException || erreur instanceof InvalidPDFException) {
        return null;
      }
      throw erreur;
    });
    if (!doc) return [];
    const jpegs: Uint8Array[] = [];
    for (let numero = 1; numero <= Math.min(doc.numPages, pages); numero += 1) {
      const jpeg = await rendreUnePage(await doc.getPage(numero), boite, qualite);
      // Une page sans dimensions n'a rien à montrer : le rendu s'arrête là,
      // une suite de pages trouée ferait lire la page 3 pour la page 2.
      if (!jpeg) break;
      jpegs.push(jpeg);
    }
    return jpegs;
  } finally {
    await tache.destroy();
  }
}

if (parentPort) {
  const reponse: RenduDePage = { jpegs: await rendre(workerData as DemandeDeRendu) };
  parentPort.postMessage(
    reponse,
    reponse.jpegs.map((j) => j.buffer as ArrayBuffer),
  );
}
