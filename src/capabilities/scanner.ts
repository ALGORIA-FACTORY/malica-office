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
/** Part minimale de l'image occupée par le document détecté. */
export const COVERAGE_MIN = 0.22;
/** Part d'encre au-dessous de laquelle une page est considérée vierge. */
export const BLANK_INK_MAX = 0.012;

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

/**
 * Le document est la plus grande zone claire de la photo. On isole cette zone
 * (seuil d'Otsu + plus grande composante connexe), on en prend l'enveloppe
 * convexe, puis le quadrilatère d'aire minimale qui la contient.
 */
export function detectQuad(gray: Uint8ClampedArray, w: number, h: number): Point[] | null {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]!] = (hist[gray[i]!] ?? 0) + 1;
  const t = otsu(hist, gray.length);

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i += 1) mask[i] = gray[i]! > t ? 1 : 0;

  // Plus grande composante connexe claire (parcours en largeur itératif).
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let bestLabel = -1;
  let bestSize = 0;
  let current = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || label[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = current;
    let size = 0;
    while (top > 0) {
      const p = stack[--top]!;
      size += 1;
      const x = p % w;
      const y = (p - x) / w;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        y > 0 ? p - w : -1,
        y < h - 1 ? p + w : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || mask[n] !== 1 || label[n] !== -1) continue;
        label[n] = current;
        stack[top++] = n;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = current;
    }
    current += 1;
  }
  // Une zone claire minuscule ou occupant toute l'image ne cadre rien.
  const area = w * h;
  if (bestLabel < 0 || bestSize < area * 0.12 || bestSize > area * 0.995) return null;

  const pts: Point[] = [];
  for (let y = 0; y < h; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x += 1) {
      if (label[y * w + x] === bestLabel) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      pts.push({ x: first, y });
      pts.push({ x: last, y });
    }
  }
  if (pts.length < 8) return null;

  const hull = convexHull(pts);
  if (hull.length < 4) return null;
  return minAreaQuad(hull);
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

/** Rectangle d'aire minimale (compas tournants) rendu en quatre sommets. */
export function minAreaQuad(hull: readonly Point[]): Point[] {
  let best: { area: number; quad: Point[] } | null = null;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    const toXY = (u: number, v: number): Point => ({ x: u * ux - v * uy, y: u * uy + v * ux });
    const quad = [toXY(minU, minV), toXY(maxU, minV), toXY(maxU, maxV), toXY(minU, maxV)];
    if (!best || area < best.area) best = { area, quad };
  }
  return best ? orderQuad(best.quad) : [];
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
export function sharpness(gray: Uint8ClampedArray, w: number, h: number): number {
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
export function inkRatio(gray: Uint8ClampedArray): number {
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
  /** Part de l'image couverte par le document détecté (0..1). */
  coverage: number;
  sharpness: number;
  inkRatio: number;
  /** Page considérée vierge : signal de fin de document. */
  blank: boolean;
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

/**
 * Analyse d'une trame de prévisualisation : contour, couverture, netteté.
 * Aucun effet de bord — l'écran peut l'appeler à chaque image de la caméra.
 */
export function analyzeFrame(data: ImageData): FrameAnalysis {
  const gray = grayOf(data);
  const quad = detectQuad(gray, data.width, data.height);
  const sharp = sharpness(gray, data.width, data.height);
  const ink = inkRatio(gray);
  const coverage = quad ? quadArea(quad) / (data.width * data.height) : 0;
  const blank = ink < BLANK_INK_MAX;
  let reason: FrameAnalysis["reason"] = "ok";
  if (!quad) reason = "no_document";
  else if (coverage < COVERAGE_MIN) reason = "too_small";
  else if (sharp < SHARPNESS_MIN) reason = "blurry";
  return {
    quad,
    coverage,
    sharpness: sharp,
    inkRatio: ink,
    blank,
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
    `${infoObj} 0 obj\n<< /Title (${pdfEscape(title)}) /Producer (Regalica Office) ` +
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

/** Compatibilité : une page unique reste un cas particulier du multi-pages. */
export function buildImagePdf(
  jpeg: Uint8Array,
  widthPx: number,
  heightPx: number,
  title: string,
): Blob {
  return buildImagesPdf([{ jpeg, widthPx, heightPx }], title);
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
}

/**
 * Photo → page redressée, normalisée et encodée sous budget.
 * L'image d'origine ne quitte jamais cette frontière.
 */
export async function preparePage(input: Blob): Promise<PreparedPage> {
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
  const analysis = analyzeFrame(ctx2d(small).getImageData(0, 0, aw, ah));

  let out = full;
  let cropped = false;
  const quadSmall = analysis.quad;
  if (quadSmall && quadSmall.length === 4) {
    const quad = quadSmall.map((p) => ({
      x: Math.min(fullW - 1, Math.max(0, p.x * (fullW / aw))),
      y: Math.min(fullH - 1, Math.max(0, p.y * (fullH / ah))),
    }));
    const q = quad as Point[];
    const wTop = Math.hypot(q[1]!.x - q[0]!.x, q[1]!.y - q[0]!.y);
    const wBottom = Math.hypot(q[2]!.x - q[3]!.x, q[2]!.y - q[3]!.y);
    const hLeft = Math.hypot(q[3]!.x - q[0]!.x, q[3]!.y - q[0]!.y);
    const hRight = Math.hypot(q[2]!.x - q[1]!.x, q[2]!.y - q[1]!.y);
    const outW = Math.round(Math.max(wTop, wBottom));
    const outH = Math.round(Math.max(hLeft, hRight));
    if (outW > 240 && outH > 240) {
      const warped = warp(fullData, quad, outW, outH);
      const wc = canvasOf(outW, outH);
      ctx2d(wc).putImageData(warped, 0, 0);
      out = wc;
      cropped = true;
    }
  }

  normalizeForReading(ctx2d(out), out.width, out.height);
  const jpeg = await encodeUnderBudget(out);
  return { jpeg, widthPx: out.width, heightPx: out.height, cropped, analysis };
}

/** Un seul PDF compact par pièce, quel que soit le nombre de pages. */
export function pagesToPdf(pages: readonly PreparedPage[], baseName = "piece"): ScanResult {
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
): Promise<ScanResult> {
  const pages: PreparedPage[] = [];
  for (const input of inputs) pages.push(await preparePage(input));
  return pagesToPdf(pages, baseName);
}

export async function scanToPdf(input: Blob, baseName = "piece"): Promise<ScanResult> {
  return scanPagesToPdf([input], baseName);
}
