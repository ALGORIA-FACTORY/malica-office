/**
 * La page A4 que dessinent le reçu et le bloc de réponse — une seule fois.
 *
 * Même échelle que les pages numérisées (A4 à 200 dpi) et même chaîne pour les
 * deux documents : on dessine sur un canevas, on encode en JPEG, on réutilise
 * l'encodeur PDF du numériseur (`buildImagesPdf`). Ce module ne dessine rien :
 * il tient la taille de la page et le chemin du canevas au PDF.
 */

/** A4 à 200 dpi, en pixels. La même échelle que les pages numérisées. */
export const LARGEUR_A4 = 1654;
export const HAUTEUR_A4 = 2339;
export const MARGE_A4 = 130;

/** Qualité JPEG : la même que les pages numérisées. */
const QUALITE_JPEG = 0.82;

/** Un canevas blanc de la taille d'une page ; `null` si le navigateur n'en donne pas. */
export function nouvelleToileA4(): {
  canevas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  const canevas = document.createElement("canvas");
  canevas.width = LARGEUR_A4;
  canevas.height = HAUTEUR_A4;
  const ctx = canevas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, LARGEUR_A4, HAUTEUR_A4);
  return { canevas, ctx };
}

/** Les pages dessinées, en un PDF (une image JPEG par page). */
export async function pdfDesToiles(
  toiles: readonly HTMLCanvasElement[],
  titre: string,
  erreurEncodage: string,
): Promise<Blob> {
  const jpegs = await Promise.all(
    toiles.map(
      (canevas) =>
        new Promise<Blob>((resoudre, rejeter) => {
          canevas.toBlob(
            (b) => (b ? resoudre(b) : rejeter(new Error(erreurEncodage))),
            "image/jpeg",
            QUALITE_JPEG,
          );
        }),
    ),
  );
  const { buildImagesPdf } = await import("./scanner");
  return buildImagesPdf(
    await Promise.all(
      jpegs.map(async (jpeg) => ({
        jpeg: new Uint8Array(await jpeg.arrayBuffer()),
        widthPx: LARGEUR_A4,
        heightPx: HAUTEUR_A4,
      })),
    ),
    titre,
  );
}
