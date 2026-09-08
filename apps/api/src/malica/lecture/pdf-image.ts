/**
 * Le scan déguisé — sortir l'image d'un PDF qui n'a pas de texte.
 *
 * Un PDF scanné n'est qu'une image dans une enveloppe. L'œil sait lire une
 * image, pas un PDF : il faut donc l'en extraire. Rastériser la page
 * demanderait un canvas, absent de Cloudflare Workers — mais on n'a pas besoin
 * de dessiner : pdf.js décode déjà l'image, quel que soit son filtre (JPEG,
 * CCITT du fax, JPX). Il ne reste qu'à la réemballer en PNG.
 *
 * L'encodeur ci-dessous est volontairement minimal : aucune compression
 * d'image, aucun rééchantillonnage, aucune perte. Les pixels sortis de pdf.js
 * sont ceux qui partent chez le modèle. `CompressionStream` fait le deflate,
 * et il existe aussi bien sur Workers que sous Node.
 */

/** Table CRC-32 du PNG, calculée une fois. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const vue = new DataView(out.buffer);
  vue.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  vue.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  const morceaux: Uint8Array[] = [];
  const lecteur = flux.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    if (value) morceaux.push(value);
  }
  const taille = morceaux.reduce((n, m) => n + m.length, 0);
  const out = new Uint8Array(taille);
  let o = 0;
  for (const m of morceaux) {
    out.set(m, o);
    o += m.length;
  }
  return out;
}

/** Encode des pixels RGB bruts en PNG sans perte. */
async function encoderPng(rgb: Uint8Array, largeur: number, hauteur: number): Promise<Uint8Array> {
  // Chaque ligne PNG est précédée de son octet de filtre — 0, aucun filtre :
  // le deflate suffit et rend l'encodage trivialement vérifiable.
  const brut = new Uint8Array(hauteur * (1 + largeur * 3));
  for (let y = 0; y < hauteur; y += 1) {
    const src = y * largeur * 3;
    const dst = y * (1 + largeur * 3);
    brut[dst] = 0;
    brut.set(rgb.subarray(src, src + largeur * 3), dst + 1);
  }

  const ihdr = new Uint8Array(13);
  const vue = new DataView(ihdr.buffer);
  vue.setUint32(0, largeur);
  vue.setUint32(4, hauteur);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 2; // couleur vraie, sans alpha
  const idat = await deflate(brut);

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parties = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parties.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parties) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

/**
 * pdf.js rend ses bitmaps sous trois formes. On les ramène toutes au RGB, la
 * seule que l'encodeur ci-dessus connaisse — l'alpha d'un scan ne porte aucune
 * information, et le blanc derrière est celui du papier.
 */
function versRgb(
  data: Uint8Array | Uint8ClampedArray,
  largeur: number,
  hauteur: number,
  kind: number,
): Uint8Array {
  const px = largeur * hauteur;
  const rgb = new Uint8Array(px * 3);

  if (kind === 3) {
    // RGBA_32BPP — on aplatit sur blanc.
    for (let i = 0; i < px; i += 1) {
      const a = data[i * 4 + 3]! / 255;
      for (let c = 0; c < 3; c += 1) {
        rgb[i * 3 + c] = Math.round(data[i * 4 + c]! * a + 255 * (1 - a));
      }
    }
    return rgb;
  }

  if (kind === 2) {
    rgb.set(data.subarray(0, px * 3));
    return rgb;
  }

  // GRAYSCALE_1BPP — un bit par pixel, lignes alignées sur l'octet.
  // C'est la forme des scans noir et blanc issus du fax (CCITT).
  const parLigne = (largeur + 7) >> 3;
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const octet = data[y * parLigne + (x >> 3)] ?? 0;
      // Dans cette forme, un bit à 0 vaut noir.
      const v = (octet >> (7 - (x & 7))) & 1 ? 255 : 0;
      const o = (y * largeur + x) * 3;
      rgb[o] = v;
      rgb[o + 1] = v;
      rgb[o + 2] = v;
    }
  }
  return rgb;
}

export interface PageImage {
  dataUrl: string;
  page: number;
  largeur: number;
  hauteur: number;
}

/**
 * Rend la plus grande image de chaque page — sur un scan, c'est la page.
 *
 * On ne compose pas les images entre elles : un scan n'en porte qu'une, et
 * inventer une composition sans canvas produirait une pièce qui n'est pas la
 * pièce. Si une page en porte plusieurs, on prend celle qui couvre le plus de
 * pixels et le relevé le dira par ce qu'il ne trouve pas.
 */
export async function extrairePagesScannees(bytes: Uint8Array, maxPages = 5): Promise<PageImage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const tache = pdfjs.getDocument({
    // Une COPIE : `getDocument` transfère le tableau et le DÉTACHE. Voir le
    // commentaire détaillé dans `pdf-text.server.ts` — c'est le même défaut,
    // et il faut le corriger des deux côtés, sans quoi l'ordre des appels
    // décide de qui casse.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    // Faux : on veut les octets bruts du bitmap, pas un ImageBitmap
    // qu'aucun encodeur ne pourrait relire hors navigateur.
    isOffscreenCanvasSupported: false,
    verbosity: 0,
  });
  const doc = await tache.promise;
  const sortie: PageImage[] = [];

  try {
    const pages = Math.min(doc.numPages, maxPages);
    for (let p = 1; p <= pages; p += 1) {
      const page = await doc.getPage(p);
      const ops = await page.getOperatorList();

      let meilleur: { data: Uint8Array; largeur: number; hauteur: number; kind: number } | null =
        null;
      for (let i = 0; i < ops.fnArray.length; i += 1) {
        if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
        const nom = (ops.argsArray[i] as unknown[])[0];
        if (typeof nom !== "string") continue;
        let obj: unknown;
        try {
          obj = page.objs.get(nom);
        } catch {
          continue; // image non résolue : on l'ignore plutôt que d'échouer
        }
        const img = obj as {
          data?: Uint8Array | Uint8ClampedArray;
          width?: number;
          height?: number;
          kind?: number;
        };
        if (!img?.data || !img.width || !img.height) continue;
        if (meilleur && img.width * img.height <= meilleur.largeur * meilleur.hauteur) continue;
        meilleur = {
          data: img.data as Uint8Array,
          largeur: img.width,
          hauteur: img.height,
          kind: img.kind ?? 2,
        };
      }

      if (!meilleur) continue;
      const rgb = versRgb(meilleur.data, meilleur.largeur, meilleur.hauteur, meilleur.kind);
      const png = await encoderPng(rgb, meilleur.largeur, meilleur.hauteur);
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < png.length; i += CHUNK) {
        bin += String.fromCharCode(...png.subarray(i, i + CHUNK));
      }
      const b64 =
        typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
      sortie.push({
        dataUrl: `data:image/png;base64,${b64}`,
        page: p,
        largeur: meilleur.largeur,
        hauteur: meilleur.hauteur,
      });
    }
  } finally {
    await tache.destroy();
  }

  return sortie;
}
