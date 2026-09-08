/**
 * Module de capacité « numérisation ».
 *
 * Une photo n'est jamais conservée : elle est cadrée (détection des quatre
 * coins du document), redressée (transformation projective), puis encodée dans
 * un PDF minimal à une page qui embarque un JPEG de haute qualité. Le PDF est
 * la seule forme stockée. Capacitor remplacera cette implémentation, pas les
 * écrans : la signature `scanToPdf(blob) -> Blob` est le contrat.
 *
 * Aucun calcul métier ici : de la géométrie d'image, rien d'autre.
 */

import { cadrer, type Cadrage } from "./cadrage";

export interface ScanResult {
  blob: Blob;
  name: string;
  /** Vrai si les quatre coins ont été détectés et le document redressé. */
  cropped: boolean;
  widthPx: number;
  heightPx: number;
  /** Nombre de pages embarquées dans le PDF. */
  pageCount: number;
  /** Poids du PDF produit, en octets. */
  bytes: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Côté maximal de l'image redressée : au-delà, l'OCR ne gagne plus rien. */
const MAX_SIDE = 1800;
/** Côté de l'image d'analyse : la détection n'a pas besoin de la pleine résolution. */
const ANALYSIS_SIDE = 640;
/** Qualité de départ, puis recherche descendante jusqu'au budget de poids. */
const JPEG_QUALITY_MAX = 0.78;
const JPEG_QUALITY_MIN = 0.42;
/** Budget de poids par page : au-delà, la qualité descend d'un cran. */
const PAGE_BYTES_BUDGET = 190_000;

/** Netteté minimale acceptée (variance du laplacien normalisée). */
export const SHARPNESS_MIN = 0.0022;
/** Part d'encre au-dessous de laquelle une page est considérée vierge. */
const BLANK_INK_MAX = 0.012;

/*
 * ============================================ CE QUE LE DÉTECTEUR NE SUPPOSE PAS
 *
 * Un document n'a pas de format. Une facture A4, un ticket de caisse, un reçu
 * de taxi, une carte d'identification fiscale, un bon de livraison plié en
 * deux : ils n'ont ni la même forme, ni le même rapport largeur/hauteur, ni la
 * même place dans le cadre.
 *
 * La version précédente en supposait trois, et chacune écartait le ticket de
 * caisse :
 *
 *   — le document devait occuper au moins 12 % de l'image pour être seulement
 *     CONSIDÉRÉ, et 22 % pour être accepté. Un ticket tenu à bout de bras en
 *     occupe 5 à 10 % : il n'existait pas.
 *
 *   — la silhouette était rendue comme un RECTANGLE d'aire minimale. Un
 *     rectangle ne peut pas décrire un document photographié de biais : le
 *     redressement projectif recevait quatre coins faux et ne redressait rien.
 *
 *   — la plus grande tache claire gagnait, sans qu'on demande jamais si elle
 *     RESSEMBLAIT à un document. Un mur clair derrière un ticket l'emportait.
 *
 * Ce qui remplace ces suppositions : on évalue PLUSIEURS candidats et on
 * retient celui qui ressemble le plus à une feuille — quadrilatère convexe et
 * plein — quelle que soit sa taille et sa proportion.
 */

/** Aire minimale d'un candidat, en part de l'image. Un ticket lointain passe. */
const AIRE_CANDIDAT_MIN = 0.012;
/** Au-delà, la tache est le fond, pas un document posé dessus. */
const AIRE_CANDIDAT_MAX = 0.995;
/**
 * Ressemblance minimale à une feuille : aire du quadrilatère rapportée à celle
 * de la silhouette, et remplissage de ce quadrilatère. Une main, une ombre ou
 * un reflet tombent au-dessous ; une feuille, même froissée, reste au-dessus.
 */
const RESSEMBLANCE_MIN = 0.55;
/**
 * Lisibilité : petit côté du document, en pixels de la photo D'ORIGINE.
 *
 * C'est le vrai critère — et il remplace « occupe 22 % du cadre ». Un ticket
 * qui ne prend qu'un dixième de l'image reste large de 800 px sur un capteur
 * de 12 Mpx : il est parfaitement lisible. La part du cadre ne disait rien ;
 * le nombre de pixels dit tout.
 */
export const PETIT_COTE_MIN_PX = 420;

// ----------------------------------------------------------------- décodage

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(blob);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image illisible"));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function sizeOf(img: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  const w = "width" in img ? img.width : 0;
  const h = "height" in img ? img.height : 0;
  return { w, h };
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("canvas 2d indisponible");
  return g;
}

// ------------------------------------------------------- détection du cadre

/** Seuil d'Otsu sur un histogramme de luminance. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Un document possible, avec de quoi juger s'il en est vraiment un. */
export interface Candidat {
  quad: Point[];
  /** Aire du quadrilatère, en pixels de l'image analysée. */
  aire: number;
  /**
   * Aire du quadrilatère rapportée à celle de la silhouette. Une feuille est
   * convexe : elle vaut presque 1. Une main, une ombre, un reflet : moins.
   */
  rectangularite: number;
  /** Pixels clairs rapportés à l'aire du quadrilatère. Une feuille est pleine. */
  remplissage: number;
  /** Le produit des deux : la ressemblance à une feuille, sans notion de taille. */
  ressemblance: number;
}

/**
 * Toutes les zones claires de l'image, évaluées une par une.
 *
 * On ne demande PAS laquelle est la plus grande — on demande laquelle
 * ressemble le plus à une feuille. C'est ce qui permet de trouver un ticket de
 * caisse posé sur un plan de travail clair, là où « la plus grande tache »
 * désignait le plan de travail.
 */
export function candidatsDocument(gray: Uint8ClampedArray, w: number, h: number): Candidat[] {
  const aireImage = w * h;
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]!] = (hist[gray[i]!] ?? 0) + 1;
  const t = otsu(hist, gray.length);

  // Étiquetage de TOUTES les composantes claires, pas seulement la plus grande.
  const label = new Int32Array(w * h).fill(-1);
  const pile = new Int32Array(w * h);
  const tailles: number[] = [];
  let courant = 0;
  for (let depart = 0; depart < gray.length; depart += 1) {
    if (gray[depart]! <= t || label[depart] !== -1) continue;
    let sommet = 0;
    pile[sommet++] = depart;
    label[depart] = courant;
    let taille = 0;
    while (sommet > 0) {
      const p = pile[--sommet]!;
      taille += 1;
      const x = p % w;
      const y = (p - x) / w;
      const voisins = [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        y > 0 ? p - w : -1,
        y < h - 1 ? p + w : -1,
      ];
      for (const n of voisins) {
        if (n < 0 || gray[n]! <= t || label[n] !== -1) continue;
        label[n] = courant;
        pile[sommet++] = n;
      }
    }
    tailles.push(taille);
    courant += 1;
  }

  // Les composantes plausibles par la taille, du plus grand au plus petit. On
  // en garde quelques-unes : la bonne n'est pas toujours la première.
  const retenues = tailles
    .map((taille, index) => ({ index, taille }))
    .filter(
      ({ taille }) =>
        taille >= aireImage * AIRE_CANDIDAT_MIN && taille <= aireImage * AIRE_CANDIDAT_MAX,
    )
    .sort((a, b) => b.taille - a.taille)
    .slice(0, 6);
  if (retenues.length === 0) return [];

  // Silhouette de chacune : premier et dernier pixel de chaque ligne. Un seul
  // parcours de l'image pour toutes, quel que soit leur nombre.
  const rang = new Int32Array(courant).fill(-1);
  retenues.forEach(({ index }, r) => {
    rang[index] = r;
  });
  const premier = new Int32Array(retenues.length * h).fill(-1);
  const dernier = new Int32Array(retenues.length * h).fill(-1);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const l = label[y * w + x]!;
      if (l < 0) continue;
      const r = rang[l]!;
      if (r < 0) continue;
      const cellule = r * h + y;
      if (premier[cellule] === -1) premier[cellule] = x;
      dernier[cellule] = x;
    }
  }

  const candidats: Candidat[] = [];
  retenues.forEach(({ taille }, r) => {
    const points: Point[] = [];
    for (let y = 0; y < h; y += 1) {
      const cellule = r * h + y;
      const a = premier[cellule]!;
      if (a < 0) continue;
      points.push({ x: a, y });
      points.push({ x: dernier[cellule]!, y });
    }
    if (points.length < 8) return;

    const enveloppe = convexHull(points);
    if (enveloppe.length < 4) return;
    const quad = maxAreaQuad(enveloppe);
    if (!quad) return;

    const aire = quadArea(quad);
    if (aire <= 0) return;
    const aireEnveloppe = quadArea(enveloppe);
    const rectangularite = aireEnveloppe > 0 ? Math.min(1, aire / aireEnveloppe) : 0;
    const remplissage = Math.min(1, taille / aire);
    candidats.push({
      quad,
      aire,
      rectangularite,
      remplissage,
      ressemblance: rectangularite * remplissage,
    });
  });

  return candidats.sort((a, b) => b.ressemblance - a.ressemblance);
}

/**
 * Le document de la photo : le candidat qui ressemble le plus à une feuille.
 *
 * Aucune condition de taille ni de proportion — un ticket de caisse, une carte
 * fiscale et une facture A4 passent par le même chemin.
 */
export function detectQuad(gray: Uint8ClampedArray, w: number, h: number): Point[] | null {
  const meilleur = candidatsDocument(gray, w, h)[0];
  if (!meilleur || meilleur.ressemblance < RESSEMBLANCE_MIN) return null;
  return meilleur.quad;
}

/** Enveloppe convexe (parcours d'Andrew). */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p!) <= 0
    ) {
      lower.pop();
    }
    lower.push(p!);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

/** Distance d'un point au segment [a, b]. */
function distanceAuSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const longueur2 = dx * dx + dy * dy;
  if (longueur2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / longueur2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Simplification de Douglas–Peucker sur une chaîne ouverte. */
function simplifierChaine(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 3) return [...points];
  let pire = 0;
  let index = 0;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = distanceAuSegment(points[i]!, a, b);
    if (d > pire) {
      pire = d;
      index = i;
    }
  }
  if (pire <= epsilon) return [a, b];
  const gauche = simplifierChaine(points.slice(0, index + 1), epsilon);
  const droite = simplifierChaine(points.slice(index), epsilon);
  return [...gauche.slice(0, -1), ...droite];
}

/**
 * Simplification d'un contour FERMÉ.
 *
 * On coupe aux deux sommets les plus éloignés l'un de l'autre, puis on
 * simplifie les deux chaînes. C'est l'équivalent d'`approxPolyDP` : une
 * silhouette de feuille, qui compte des centaines de points de bord, se réduit
 * à ses quelques vrais coins.
 */
export function simplifierContour(contour: readonly Point[], epsilon: number): Point[] {
  const n = contour.length;
  if (n < 4) return [...contour];
  let a = 0;
  let b = 0;
  let plusLoin = -1;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = Math.hypot(contour[i]!.x - contour[j]!.x, contour[i]!.y - contour[j]!.y);
      if (d > plusLoin) {
        plusLoin = d;
        a = i;
        b = j;
      }
    }
  }
  const premiere = contour.slice(a, b + 1);
  const seconde = [...contour.slice(b), ...contour.slice(0, a + 1)];
  const g = simplifierChaine(premiere, epsilon);
  const d = simplifierChaine(seconde, epsilon);
  return [...g.slice(0, -1), ...d.slice(0, -1)];
}

function aireTriangle(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/**
 * Le quadrilatère d'aire MAXIMALE inscrit dans la silhouette.
 *
 * =================================================== POURQUOI PAS UN RECTANGLE
 *
 * La version précédente rendait le RECTANGLE d'aire minimale contenant la
 * silhouette. Un rectangle a quatre angles droits : il ne peut pas décrire une
 * feuille photographiée de biais, dont les quatre coins forment un trapèze.
 *
 * Le redressement projectif qui suit — `warp`, une vraie homographie — recevait
 * donc quatre coins qui n'étaient pas ceux du document, et redressait une forme
 * qui n'existait pas. D'où des bords de table dans l'image finale, et un
 * document toujours de travers. Le mécanisme était bon ; on le nourrissait mal.
 *
 * Les quatre sommets sont ici INDÉPENDANTS : ils épousent la perspective réelle,
 * quelle que soit la proportion du document.
 */
export function maxAreaQuad(enveloppe: readonly Point[]): Point[] | null {
  if (enveloppe.length < 4) return null;

  // Réduction préalable aux vrais coins : sans elle, la recherche exhaustive
  // coûterait trop cher pour tourner cinq fois par seconde sur un téléphone.
  let perimetre = 0;
  for (let i = 0; i < enveloppe.length; i += 1) {
    const p = enveloppe[i]!;
    const q = enveloppe[(i + 1) % enveloppe.length]!;
    perimetre += Math.hypot(q.x - p.x, q.y - p.y);
  }
  let sommets = simplifierContour(enveloppe, perimetre * 0.02);
  if (sommets.length < 4) sommets = simplifierContour(enveloppe, perimetre * 0.008);
  if (sommets.length < 4) sommets = [...enveloppe];
  if (sommets.length < 4) return null;

  // Au-delà, on ne garde que les sommets les plus « anguleux » : ce sont les
  // coins. Borne l'exploration sans jamais écarter un vrai coin.
  if (sommets.length > 12) {
    const n = sommets.length;
    sommets = sommets
      .map((p, i) => {
        const avant = sommets[(i - 1 + n) % n]!;
        const apres = sommets[(i + 1) % n]!;
        return { p, i, virage: distanceAuSegment(p, avant, apres) };
      })
      .sort((a, b) => b.virage - a.virage)
      .slice(0, 12)
      .sort((a, b) => a.i - b.i)
      .map(({ p }) => p);
  }

  const n = sommets.length;
  let meilleure = -1;
  let quad: Point[] | null = null;
  for (let i = 0; i < n - 3; i += 1) {
    for (let j = i + 1; j < n - 2; j += 1) {
      for (let k = j + 1; k < n - 1; k += 1) {
        for (let l = k + 1; l < n; l += 1) {
          // L'ordre cyclique de l'enveloppe est conservé : i<j<k<l décrit
          // toujours un quadrilatère simple, jamais croisé.
          const aire =
            aireTriangle(sommets[i]!, sommets[j]!, sommets[k]!) +
            aireTriangle(sommets[i]!, sommets[k]!, sommets[l]!);
          if (aire > meilleure) {
            meilleure = aire;
            quad = [sommets[i]!, sommets[j]!, sommets[k]!, sommets[l]!];
          }
        }
      }
    }
  }
  return quad ? orderQuad(quad) : null;
}

/** Sommets ordonnés haut-gauche, haut-droit, bas-droit, bas-gauche. */
export function orderQuad(quad: readonly Point[]): Point[] {
  const cx = quad.reduce((s, p) => s + p.x, 0) / quad.length;
  const cy = quad.reduce((s, p) => s + p.y, 0) / quad.length;
  const sorted = [...quad].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let startIndex = 0;
  let bestScore = Infinity;
  sorted.forEach((p, i) => {
    const score = p.x + p.y;
    if (score < bestScore) {
      bestScore = score;
      startIndex = i;
    }
  });
  return [0, 1, 2, 3].map((k) => sorted[(startIndex + k) % 4]!);
}

// -------------------------------------------------------- redressement

/** Homographie qui envoie le quadrilatère source sur un rectangle w×h. */
function homography(src: readonly Point[], w: number, h: number): number[] {
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  // Résolution de A·x = b (8 inconnues) par élimination de Gauss.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const s = src[i]!;
    const d = dst[i]!;
    A.push([d.x, d.y, 1, 0, 0, 0, -s.x * d.x, -s.x * d.y]);
    b.push(s.x);
    A.push([0, 0, 0, d.x, d.y, 1, -s.y * d.x, -s.y * d.y]);
    b.push(s.y);
  }
  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r;
    }
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const p = A[col]![col]!;
    if (Math.abs(p) < 1e-12) continue;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = A[r]![col]! / p;
      if (f === 0) continue;
      for (let c = col; c < n; c += 1) A[r]![c]! -= f * A[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    x[i] = Math.abs(A[i]![i]!) < 1e-12 ? 0 : b[i]! / A[i]![i]!;
  }
  return [...x, 1];
}

function warp(source: ImageData, quad: readonly Point[], outW: number, outH: number): ImageData {
  const H = homography(quad, outW, outH);
  const out = new ImageData(outW, outH);
  const sw = source.width;
  const sh = source.height;
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const denom = H[6]! * x + H[7]! * y + H[8]!;
      const sx = (H[0]! * x + H[1]! * y + H[2]!) / denom;
      const sy = (H[3]! * x + H[4]! * y + H[5]!) / denom;
      const o = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        out.data[o] = 255;
        out.data[o + 1] = 255;
        out.data[o + 2] = 255;
        out.data[o + 3] = 255;
        continue;
      }
      // Interpolation bilinéaire : pas de crénelage sur le texte.
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c += 1) {
        const p00 = source.data[(y0 * sw + x0) * 4 + c]!;
        const p10 = source.data[(y0 * sw + x1) * 4 + c]!;
        const p01 = source.data[(y1 * sw + x0) * 4 + c]!;
        const p11 = source.data[(y1 * sw + x1) * 4 + c]!;
        out.data[o + c] =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

// ------------------------------------------------------------- qualité image

/** Luminance 0..255 d'une ImageData, sans allocation superflue. */
export function grayOf(data: ImageData): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(data.width * data.height);
  for (let i = 0; i < gray.length; i += 1) {
    const o = i * 4;
    gray[i] = (data.data[o]! * 299 + data.data[o + 1]! * 587 + data.data[o + 2]! * 114) / 1000;
  }
  return gray;
}

/**
 * Netteté : variance du laplacien, normalisée par le carré de la dynamique.
 * Une photo floue produit un laplacien plat ; le seuil est indépendant de
 * l'exposition, donc utilisable tel quel sur mobile.
 */
function sharpness(gray: Uint8ClampedArray, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const l = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      sum += l;
      sumSq += l * l;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return variance / (255 * 255);
}

/** Part de pixels sombres : sert à repérer une page vierge (fin de document). */
function inkRatio(gray: Uint8ClampedArray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]!] = hist[gray[i]!]! + 1;
  const t = otsu(hist, gray.length);
  // Une page vierge n'a pas deux modes : on compare au seuil et à la moyenne.
  let dark = 0;
  for (let i = 0; i < gray.length; i += 1) if (gray[i]! < t - 25) dark += 1;
  return dark / gray.length;
}

export interface FrameAnalysis {
  quad: Point[] | null;
  /** Part de l'image couverte par le document détecté (0..1). Informatif. */
  coverage: number;
  /**
   * Netteté mesurée DANS le document, pas sur toute l'image.
   *
   * Sur toute l'image, un ticket net posé sur un tapis à motifs passait pour
   * net grâce au tapis, et un document net sur une table unie passait pour
   * flou à cause de la table. La mesure ne portait pas sur ce qu'on
   * photographie.
   */
  sharpness: number;
  inkRatio: number;
  /** Page considérée vierge : signal de fin de document. */
  blank: boolean;
  /** Petit côté du document, en pixels de la photo d'origine. */
  petitCotePx: number;
  ok: boolean;
  reason: "ok" | "no_document" | "too_small" | "blurry";
}

function quadArea(quad: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const p = quad[i]!;
    const q = quad[(i + 1) % quad.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Les deux côtés d'un quadrilatère, moyennés sur les paires opposées. */
function cotesDuQuad(quad: readonly Point[]): { court: number; long: number } {
  const d = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const haut = d(quad[0]!, quad[1]!);
  const bas = d(quad[3]!, quad[2]!);
  const gauche = d(quad[0]!, quad[3]!);
  const droite = d(quad[1]!, quad[2]!);
  const largeur = Math.max(haut, bas);
  const hauteur = Math.max(gauche, droite);
  return { court: Math.min(largeur, hauteur), long: Math.max(largeur, hauteur) };
}

/** Recadrage rectangulaire de la luminance sur l'emprise du quadrilatère. */
function dansLeQuad(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  quad: readonly Point[],
): { gray: Uint8ClampedArray; w: number; h: number } | null {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  if (cw < 3 || ch < 3) return null;
  const dedans = new Uint8ClampedArray(cw * ch);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      dedans[y * cw + x] = gray[(y + y0) * w + (x + x0)]!;
    }
  }
  return { gray: dedans, w: cw, h: ch };
}

/**
 * Analyse d'une trame : quel document, à quelle netteté, assez lisible ou non.
 *
 * `sourceGrandCotePx` est le grand côté de la photo D'ORIGINE — la trame
 * analysée est réduite, et c'est la résolution vraie qui décide de la
 * lisibilité. Sans elle, on retombe sur « occupe-t-il assez de cadre ? », qui
 * écartait les petits formats.
 *
 * Aucun effet de bord — l'écran peut l'appeler à chaque image de la caméra.
 */
export function analyzeFrame(
  data: ImageData,
  sourceGrandCotePx?: number,
  /*
   * Les coins, quand un meilleur détecteur les a déjà trouvés.
   *
   * ============================================== POURQUOI CE PARAMÈTRE EXISTE
   *
   * L'aperçu en direct jugeait avec le détecteur maison, tandis que la capture
   * cadrait avec le modèle entraîné. Les deux ne voyaient pas la même chose :
   * le voyant passait au vert sur une scène que la capture allait rater, et
   * restait ambre sur une scène que le modèle trouvait parfaitement.
   *
   * Un voyant qui ment est pire que pas de voyant. L'écran passe donc ici les
   * coins de la cascade, et cette fonction ne juge plus que ce qu'elle sait
   * bien juger : la netteté DANS le document, sa lisibilité, et la page vierge.
   */
  quadFourni?: Point[] | null,
): FrameAnalysis {
  const gray = grayOf(data);
  const quad = quadFourni ?? detectQuad(gray, data.width, data.height);
  const ink = inkRatio(gray);
  const blank = ink < BLANK_INK_MAX;
  const coverage = quad ? quadArea(quad) / (data.width * data.height) : 0;

  // La netteté se mesure sur le document. À défaut d'en avoir trouvé un, sur
  // l'image entière — c'est alors la seule information disponible.
  const zone = quad ? dansLeQuad(gray, data.width, data.height, quad) : null;
  const sharp = zone
    ? sharpness(zone.gray, zone.w, zone.h)
    : sharpness(gray, data.width, data.height);

  // Facteur d'échelle vers la photo d'origine : la trame est une réduction.
  const grandCoteAnalyse = Math.max(data.width, data.height);
  const echelle =
    sourceGrandCotePx && grandCoteAnalyse > 0 ? sourceGrandCotePx / grandCoteAnalyse : 1;
  const petitCotePx = quad ? cotesDuQuad(quad).court * echelle : 0;

  let reason: FrameAnalysis["reason"] = "ok";
  if (!quad) reason = "no_document";
  else if (petitCotePx < PETIT_COTE_MIN_PX) reason = "too_small";
  else if (sharp < SHARPNESS_MIN) reason = "blurry";
  return {
    quad,
    coverage,
    sharpness: sharp,
    inkRatio: ink,
    blank,
    petitCotePx,
    ok: reason === "ok",
    reason,
  };
}

// ---------------------------------------------------------------- PDF

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export interface PdfPageImage {
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
}

/**
 * PDF multi-pages, une image JPEG par page en flux `DCTDecode` : aucune
 * recompression, donc le poids du PDF est celui des JPEG à quelques centaines
 * d'octets près.
 */
export function buildImagesPdf(pages: readonly PdfPageImage[], title: string): Blob {
  if (pages.length === 0) throw new Error("aucune page à encoder");
  // 200 dpi : 1 px = 72/200 pt.
  const scale = 72 / 200;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const startObject = () => {
    offsets.push(length);
  };

  // 1 catalogue, 2 arbre de pages, puis 3 objets par page, puis l'info.
  const pageObj = (i: number) => 3 + i * 3;
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
  const infoObj = 3 + pages.length * 3;

  push("%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n");
  startObject();
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObject();
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const pw = +(page.widthPx * scale).toFixed(2);
    const ph = +(page.heightPx * scale).toFixed(2);
    const n = pageObj(i);
    startObject();
    push(
      `${n} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
        `/Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>\nendobj\n`,
    );
    startObject();
    push(
      `${n + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.widthPx} ` +
        `/Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
    const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ\n`;
    startObject();
    push(`${n + 2} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  startObject();
  push(
    `${infoObj} 0 obj\n<< /Title (${pdfEscape(title)}) /Producer (Malica Office) ` +
      `/CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>\nendobj\n`,
  );

  const xrefStart = length;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`,
  );

  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

// ------------------------------------------------------ affinage des coins

/** Une droite : un point et une direction unitaire. */
interface Droite {
  p: Point;
  d: Point;
}

function droiteParDeuxPoints(a: Point, b: Point): Droite {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.hypot(dx, dy) || 1;
  return { p: a, d: { x: dx / n, y: dy / n } };
}

function intersection(a: Droite, b: Droite): Point | null {
  const det = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / det;
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
}

/** Distance signée d'un point à une droite. */
function ecart(p: Point, l: Droite): number {
  return (p.x - l.p.x) * -l.d.y + (p.y - l.p.y) * l.d.x;
}

/**
 * Ajuste une droite sur des points, en écartant ceux qui s'en éloignent.
 * Moindres carrés totaux (axe principal), puis rejet des écarts aberrants,
 * puis second ajustement. `null` si les points restants ne dessinent pas
 * une droite nette.
 */
function ajusterDroite(points: readonly Point[]): Droite | null {
  const MIN = 6;
  const passe = (pts: readonly Point[]): Droite | null => {
    if (pts.length < MIN) return null;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    // Axe principal de la matrice de covariance 2×2.
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { p: { x: cx, y: cy }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
  };

  const premiere = passe(points);
  if (!premiere) return null;
  const residus = points.map((p) => Math.abs(ecart(p, premiere)));
  const tries = [...residus].sort((a, b) => a - b);
  const mediane = tries[Math.floor(tries.length / 2)] ?? 0;
  const tolerance = Math.max(1.5, 2.5 * mediane);
  const gardes = points.filter((_, i) => residus[i]! <= tolerance);
  const seconde = passe(gardes);
  if (!seconde) return null;
  let carre = 0;
  for (const p of gardes) carre += ecart(p, seconde) ** 2;
  const rms = Math.sqrt(carre / gardes.length);
  return rms <= 2.5 ? seconde : null;
}

/**
 * Le rayon de recherche autour d'un bord approximatif : 2,5 % du grand côté,
 * au moins six pixels. Assez pour absorber l'erreur d'échelle des détecteurs,
 * trop peu pour aller chercher une ligne de texte à l'intérieur de la page.
 */
export function rayonDAffinage(w: number, h: number): number {
  return Math.max(6, Math.round(Math.max(w, h) * 0.025));
}

/**
 * Accroche un quadrilatère approximatif aux bords réels de la feuille.
 *
 * Pour chaque côté, on échantillonne des points le long du bord approximatif
 * et l'on cherche, perpendiculairement, la transition la plus franche entre
 * papier et fond. Une droite est ajustée sur ces transitions ; les coins
 * sont les intersections des droites voisines.
 *
 * Prudence avant précision : un côté sans transition nette garde sa droite
 * d'origine ; un coin qui s'éloignerait trop garde sa place ; un résultat qui
 * ne serait plus un quadrilatère convexe de surface comparable est rejeté
 * en bloc. L'affinage ne peut qu'améliorer, jamais casser.
 */
export function affinerLesCoins(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  quad: readonly Point[],
  rayon = rayonDAffinage(w, h),
): Point[] {
  if (quad.length !== 4) return [...quad];
  const ECHANTILLONS = 28;
  const SEUIL_GRADIENT = 12;
  const lire = (x: number, y: number): number => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    return gray[yi * w + xi]!;
  };

  const droites: Droite[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const origine = droiteParDeuxPoints(a, b);
    const normale = { x: -origine.d.y, y: origine.d.x };
    const longueur = Math.hypot(b.x - a.x, b.y - a.y);
    const points: Point[] = [];
    // On évite les extrémités : près d'un coin, le bord voisin brouille la
    // transition.
    for (let k = 0; k < ECHANTILLONS; k += 1) {
      const f = 0.08 + (0.84 * k) / (ECHANTILLONS - 1);
      const sx = a.x + (b.x - a.x) * f;
      const sy = a.y + (b.y - a.y) * f;
      // Le gradient est mesuré sur quatre pixels : un bord net donne le même
      // maximum sur plusieurs positions voisines. La transition est au CENTRE
      // de ce plateau — garder la première position la décalait vers l'extérieur.
      const gradients: number[] = [];
      let meilleur = -Infinity;
      for (let t = -rayon; t <= rayon; t += 1) {
        const avant = lire(sx + normale.x * (t - 2), sy + normale.y * (t - 2));
        const apres = lire(sx + normale.x * (t + 2), sy + normale.y * (t + 2));
        const g = Math.abs(apres - avant);
        gradients.push(g);
        if (g > meilleur) meilleur = g;
      }
      if (meilleur >= SEUIL_GRADIENT && longueur > 0) {
        let somme = 0;
        let n = 0;
        for (let k = 0; k < gradients.length; k += 1) {
          if (gradients[k]! >= meilleur - 1) {
            somme += k - rayon;
            n += 1;
          }
        }
        const ou = somme / n;
        points.push({ x: sx + normale.x * ou, y: sy + normale.y * ou });
      }
    }
    droites.push(ajusterDroite(points) ?? origine);
  }

  const affine: Point[] = [];
  for (let i = 0; i < 4; i += 1) {
    const avant = droites[(i + 3) % 4]!;
    const apres = droites[i]!;
    const coin = intersection(avant, apres);
    const origine = quad[i]!;
    if (!coin || Math.hypot(coin.x - origine.x, coin.y - origine.y) > rayon * 1.5) {
      affine.push({ x: origine.x, y: origine.y });
    } else {
      affine.push(coin);
    }
  }

  // Le résultat doit rester un quadrilatère convexe de surface comparable.
  const aireAvant = quadArea(quad);
  const aireApres = quadArea(affine);
  if (aireAvant <= 0 || aireApres < aireAvant * 0.8 || aireApres > aireAvant * 1.2) {
    return [...quad];
  }
  let signe = 0;
  for (let i = 0; i < 4; i += 1) {
    const p = affine[i]!;
    const q = affine[(i + 1) % 4]!;
    const r = affine[(i + 2) % 4]!;
    const z = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (z === 0) continue;
    if (signe === 0) signe = Math.sign(z);
    else if (Math.sign(z) !== signe) return [...quad];
  }
  return affine;
}

// ------------------------------------------------------------ orchestration

async function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
  if (!blob) throw new Error("encodage JPEG impossible");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Encodage sous budget : on descend la qualité par crans tant que la page pèse
 * plus que le budget, sans jamais passer sous le plancher de lisibilité.
 */
async function encodeUnderBudget(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  let best = await toJpeg(canvas, JPEG_QUALITY_MAX);
  let q = JPEG_QUALITY_MAX;
  while (best.length > PAGE_BYTES_BUDGET && q > JPEG_QUALITY_MIN) {
    q = Math.max(JPEG_QUALITY_MIN, q - 0.08);
    best = await toJpeg(canvas, q);
  }
  return best;
}

/**
 * Passage en niveaux de gris avec étirement de dynamique : le texte gagne en
 * contraste, les plans de chrominance du JPEG deviennent plats — la page pèse
 * deux à trois fois moins pour une lisibilité supérieure.
 */
function normalizeForReading(g: CanvasRenderingContext2D, w: number, h: number): void {
  const data = g.getImageData(0, 0, w, h);
  const gray = grayOf(data);
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]!] = hist[gray[i]!]! + 1;
  // Percentiles 2 % / 98 % : l'étirement ignore les extrêmes parasites.
  const total = gray.length;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v]!;
    if (acc >= total * 0.02) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) {
    acc += hist[v]!;
    if (acc >= total * 0.02) {
      hi = v;
      break;
    }
  }
  const span = Math.max(24, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    lut[v] = Math.min(255, Math.max(0, ((v - lo) / span) * 255));
  }
  for (let i = 0; i < gray.length; i += 1) {
    const o = i * 4;
    const v = lut[gray[i]!]!;
    data.data[o] = v;
    data.data[o + 1] = v;
    data.data[o + 2] = v;
    data.data[o + 3] = 255;
  }
  g.putImageData(data, 0, 0);
}

export interface PreparedPage extends PdfPageImage {
  cropped: boolean;
  analysis: FrameAnalysis;
  /**
   * Qui a trouvé les bords, et avec quelle assurance.
   *
   * ============================================== POURQUOI ÇA REMONTE JUSQU'ICI
   *
   * Quand personne ne les trouve, la page reste la photo entière — bureau,
   * tasse de café et tout le reste. C'est acceptable, à une condition : que
   * l'écran le SACHE et propose d'ajuster les coins. La version précédente ne
   * le disait pas, et l'utilisateur croyait le cadrage réussi.
   */
  cadrage: Cadrage;
}

/**
 * Photo → page redressée, normalisée et encodée sous budget.
 * L'image d'origine ne quitte jamais cette frontière.
 */
export interface OptionsDePreparation {
  /**
   * La page vient du scanner de l'appareil — VisionKit, ML Kit — et ses bords
   * sont déjà trouvés, redressés, retouchés au doigt. La recadrer ici
   * refaisait tout le travail sur le fil principal, modèle compris : cinq à
   * quinze secondes d'écran figé pour cinq pages sur un téléphone à 3 Go. On
   * ne fait plus que réduire, normaliser et encoder.
   */
  dejaCadree?: boolean;
}

export async function preparePage(
  input: Blob,
  options: OptionsDePreparation = {},
): Promise<PreparedPage> {
  const img = await decode(input);
  const { w: iw, h: ih } = sizeOf(img);
  if (!iw || !ih) throw new Error("image illisible");

  const fullScale = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  const fullW = Math.round(iw * fullScale);
  const fullH = Math.round(ih * fullScale);
  const full = canvasOf(fullW, fullH);
  ctx2d(full).drawImage(img as CanvasImageSource, 0, 0, fullW, fullH);
  const fullData = ctx2d(full).getImageData(0, 0, fullW, fullH);

  // Analyse sur une réduction : la détection est stable et immédiate.
  const aScale = Math.min(1, ANALYSIS_SIDE / Math.max(fullW, fullH));
  const aw = Math.max(1, Math.round(fullW * aScale));
  const ah = Math.max(1, Math.round(fullH * aScale));
  const small = canvasOf(aw, ah);
  ctx2d(small).drawImage(full, 0, 0, aw, ah);
  // Le grand côté de l'image pleine : c'est lui qui décide de la lisibilité,
  // pas la taille de la réduction sur laquelle on détecte.
  const petite = ctx2d(small).getImageData(0, 0, aw, ah);
  const analysis = analyzeFrame(petite, Math.max(fullW, fullH));

  /*
   * ============================================== LA TASSE DE CAFÉ DANS LA PHOTO
   *
   * Le détecteur maison cherchait la plus grande zone claire ressemblant à une
   * feuille. Sur un bureau réel — bois clair, sous-main, une tasse posée à
   * côté — il ne trouve rien, et l'on gardait la photo entière EN SILENCE.
   *
   * On passe donc par la cascade : d'abord un modèle entraîné, qui sait dire
   * s'il y a un document et où ; l'algorithme ensuite ; le détecteur maison en
   * dernier recours. Et quand les trois échouent, `cadrage.origine` vaut
   * « aucune » — l'écran le sait et propose d'ajuster les coins.
   */
  const cadrage: Cadrage = options.dejaCadree
    ? { coins: null, certitude: null, origine: "appareil" }
    : await cadrer(petite);

  let out = full;
  let cropped = cadrage.origine === "appareil";
  const quadSmall = cadrage.coins;
  if (quadSmall && quadSmall.length === 4) {
    const quad = quadSmall.map((p) => ({
      x: Math.min(fullW - 1, Math.max(0, p.x * (fullW / aw))),
      y: Math.min(fullH - 1, Math.max(0, p.y * (fullH / ah))),
    }));
    // Détecté sur la réduction, accroché sur l'image pleine : c'est ici que
    // la bande de table et l'inclinaison disparaissent.
    const q = affinerLesCoins(grayOf(fullData), fullW, fullH, quad as Point[]);
    const wTop = Math.hypot(q[1]!.x - q[0]!.x, q[1]!.y - q[0]!.y);
    const wBottom = Math.hypot(q[2]!.x - q[3]!.x, q[2]!.y - q[3]!.y);
    const hLeft = Math.hypot(q[3]!.x - q[0]!.x, q[3]!.y - q[0]!.y);
    const hRight = Math.hypot(q[2]!.x - q[1]!.x, q[2]!.y - q[1]!.y);
    const outW = Math.round(Math.max(wTop, wBottom));
    const outH = Math.round(Math.max(hLeft, hRight));
    if (outW > 240 && outH > 240) {
      const warped = warp(fullData, q, outW, outH);
      const wc = canvasOf(outW, outH);
      ctx2d(wc).putImageData(warped, 0, 0);
      out = wc;
      cropped = true;
    }
  }

  normalizeForReading(ctx2d(out), out.width, out.height);
  const jpeg = await encodeUnderBudget(out);
  return { jpeg, widthPx: out.width, heightPx: out.height, cropped, analysis, cadrage };
}

/** Un seul PDF compact par pièce, quel que soit le nombre de pages. */
function pagesToPdf(pages: readonly PreparedPage[], baseName = "piece"): ScanResult {
  if (pages.length === 0) throw new Error("aucune page à encoder");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${baseName}-${stamp}.pdf`;
  const blob = buildImagesPdf(pages, name);
  const first = pages[0]!;
  return {
    blob,
    name,
    cropped: pages.every((p) => p.cropped),
    widthPx: first.widthPx,
    heightPx: first.heightPx,
    pageCount: pages.length,
    bytes: blob.size,
  };
}

/**
 * Photos → PDF cadré, redressé, lisible et léger — une page par photo.
 * Les blobs d'origine ne sont jamais renvoyés : rien n'est stocké en image.
 */
export async function scanPagesToPdf(
  inputs: readonly Blob[],
  baseName = "piece",
  options: OptionsDePreparation = {},
): Promise<ScanResult> {
  const pages: PreparedPage[] = [];
  for (const input of inputs) pages.push(await preparePage(input, options));
  return pagesToPdf(pages, baseName);
}

export async function scanToPdf(input: Blob, baseName = "piece"): Promise<ScanResult> {
  return scanPagesToPdf([input], baseName);
}
