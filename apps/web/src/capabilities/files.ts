/**
 * Module de capacité « fichiers » — seul endroit qui parle au navigateur.
 * Le passage à Capacitor remplace cette implémentation, pas les écrans.
 */

import { scanPagesToPdf, scanToPdf } from "./scanner";

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

function pick(accept: string, capture: boolean): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      resolve(
        file
          ? {
              blob: file,
              name: file.name,
              source: file.type === "application/pdf" ? "pdf" : "photo",
            }
          : null,
      );
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Une image ne quitte jamais cette frontière : elle est cadrée, redressée puis
 * encodée en PDF. Aucune pièce n'est stockée en image.
 */
async function scan(accept: string, capture: boolean): Promise<PickedFile | null> {
  const picked = await pick(accept, capture);
  if (!picked) return null;
  if (picked.source === "pdf") return picked;
  const base = picked.name.replace(/\.[^.]+$/, "") || "piece";
  const scanned = await scanToPdf(picked.blob, base);
  return { blob: scanned.blob, name: scanned.name, source: "photo", cropped: scanned.cropped };
}

/**
 * Plusieurs pages, un seul PDF compact : la pièce reste une pièce.
 */
async function scanPages(pages: readonly Blob[], baseName = "piece"): Promise<PickedFile | null> {
  if (pages.length === 0) return null;
  const scanned = await scanPagesToPdf(pages, baseName);
  return { blob: scanned.blob, name: scanned.name, source: "photo", cropped: scanned.cropped };
}

export const files = {
  takePhoto: () => scan(IMAGE_ACCEPT, true),
  pickImage: () => scan(IMAGE_ACCEPT, false),
  pickPdf: () => pick(PDF_ACCEPT, false),
  scanPages,
  newIdempotencyKey: () => crypto.randomUUID(),
};
