/**
 * Module de capacité « fichiers » — seul endroit qui parle au navigateur.
 * Le passage à Capacitor remplace cette implémentation, pas les écrans.
 */

import { numeriseurDeLAppareil } from "./numerisation";
import { scanPagesToPdf, scanToPdf, type OptionsDePreparation } from "./scanner";

export interface PickedFile {
  blob: Blob;
  name: string;
  /** Provenance : appareil photo ou fichier PDF. Le stockage, lui, est toujours PDF. */
  source: "photo" | "pdf";
  /** Vrai si le document a été détecté et redressé avant l'encodage PDF. */
  cropped?: boolean;
}

const IMAGE_ACCEPT = "image/*";
const PDF_ACCEPT = "application/pdf";

/**
 * Des fichiers choisis comme PDF qui n'en sont pas.
 *
 * Recette du 20 octobre 2026 : un `.txt`, ou un fichier renommé en `.pdf`,
 * entrait comme une facture et consommait une lecture. `accept` n'est qu'un
 * conseil au sélecteur ; ce qui fait foi, ce sont les premiers octets — un
 * PDF commence par `%PDF-`.
 */
export class FichierNonPdf extends Error {
  readonly noms: readonly string[];
  constructor(noms: readonly string[]) {
    super(`pas un PDF : ${noms.join(", ")}`);
    this.name = "FichierNonPdf";
    this.noms = noms;
  }
}

/** Le fichier commence-t-il par la signature d'un PDF ? */
async function estUnPdf(blob: Blob): Promise<boolean> {
  const morceau = blob.slice(0, 1024);
  const octets =
    typeof morceau.arrayBuffer === "function"
      ? await morceau.arrayBuffer()
      : await new Promise<ArrayBuffer>((ok, ko) => {
          const r = new FileReader();
          r.onload = () => ok(r.result as ArrayBuffer);
          r.onerror = () => ko(r.error);
          r.readAsArrayBuffer(morceau);
        });
  // La norme tolère quelques octets avant l'en-tête : on le cherche dans le premier kilo.
  return String.fromCharCode(...new Uint8Array(octets)).includes("%PDF");
}

async function pickPdfs(): Promise<PickedFile[]> {
  const choisis = await pick(PDF_ACCEPT, false, true);
  const refuses: string[] = [];
  for (const f of choisis) if (!(await estUnPdf(f.blob))) refuses.push(f.name);
  if (refuses.length > 0) throw new FichierNonPdf(refuses);
  return choisis;
}

/**
 * Choisir des fichiers.
 *
 * ================================================= POURQUOI « PLUSIEURS »
 *
 * 11 octobre 2026 : « et l'upload plusieurs doc pdf ? »
 *
 * L'entrée n'avait pas l'attribut `multiple` : un document à la fois. Pour
 * quelqu'un qui rattrape un mois de factures, c'est trente allers-retours —
 * et trente occasions d'arrêter en route.
 *
 * `plusieurs` ne change rien au cas d'un seul : l'appel rend un tableau, et
 * un tableau d'un élément se traite comme avant. La photo, elle, reste
 * unitaire : on ne prend pas deux photos à la fois, et le multi-page d'UNE
 * pièce a déjà son chemin.
 */
function pick(accept: string, capture: boolean, plusieurs: boolean): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve([]);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    if (plusieurs) input.multiple = true;
    input.onchange = () => {
      resolve(
        [...(input.files ?? [])].map((file) => ({
          blob: file,
          name: file.name,
          source: file.type === "application/pdf" ? ("pdf" as const) : ("photo" as const),
        })),
      );
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/**
 * Une image ne quitte jamais cette frontière : elle est cadrée, redressée puis
 * encodée en PDF. Aucune pièce n'est stockée en image.
 *
 * Le cadrage se fait EN SÉRIE, une image après l'autre. Dix images cadrées
 * ensemble font dix canevas vivants en même temps, et un téléphone d'entrée
 * de gamme rend l'âme avant la cinquième.
 */
async function scan(accept: string, capture: boolean, plusieurs = false): Promise<PickedFile[]> {
  const choisis = await pick(accept, capture, plusieurs);
  const prets: PickedFile[] = [];
  for (const picked of choisis) {
    if (picked.source === "pdf") {
      prets.push(picked);
      continue;
    }
    const base = picked.name.replace(/\.[^.]+$/, "") || "piece";
    const scanned = await scanToPdf(picked.blob, base);
    prets.push({
      blob: scanned.blob,
      name: scanned.name,
      source: "photo",
      cropped: scanned.cropped,
    });
  }
  return prets;
}

/**
 * Plusieurs pages, un seul PDF compact : la pièce reste une pièce.
 */
async function scanPages(
  pages: readonly Blob[],
  options: OptionsDePreparation = {},
  baseName = "piece",
): Promise<PickedFile | null> {
  if (pages.length === 0) return null;
  const scanned = await scanPagesToPdf(pages, baseName, options);
  return { blob: scanned.blob, name: scanned.name, source: "photo", cropped: scanned.cropped };
}

export const files = {
  /**
   * Le scanner de l'appareil lui-même — VisionKit sur iOS, ML Kit sur Android.
   *
   * `null` hors de la coque native, et c'est le cas courant : l'écran ouvre
   * alors son propre cadrage. Rien d'autre ne change, parce que les deux
   * rendent la même chose : des pages déjà redressées.
   */
  scannerDeLAppareil: numeriseurDeLAppareil,
  /** Une photo : on n'en prend pas deux à la fois. */
  takePhoto: () => scan(IMAGE_ACCEPT, true),
  /** Plusieurs images d'un coup — autant de pièces, chacune cadrée. */
  pickImages: () => scan(IMAGE_ACCEPT, false, true),
  /** Plusieurs PDF d'un coup : c'est le cas du rattrapage d'un mois. */
  pickPdfs,
  /** Plusieurs PAGES d'UNE pièce — à ne pas confondre avec ce qui précède. */
  scanPages,
  newIdempotencyKey: () => crypto.randomUUID(),
};
