import { describe, expect, it } from "vitest";

import { pagesJpegDuPdf } from "../pages-du-pdf";
import { buildImagesPdf } from "../scanner";

/** Une « image » : n'importe quels octets, le découpage ne décode pas. */
function image(remplissage: number, taille: number): Uint8Array {
  const o = new Uint8Array(taille);
  for (let i = 0; i < taille; i += 1) o[i] = (remplissage + i) & 0xff;
  // Des octets qui ressemblent à des marqueurs JPEG au milieu : ils ne
  // doivent pas tromper le découpage, qui suit la structure du PDF.
  o[7] = 0xff;
  o[8] = 0xd9;
  return o;
}

describe("pagesJpegDuPdf", () => {
  it("rend chaque page, octet pour octet, dans l'ordre du fichier", async () => {
    const une = image(1, 1500);
    const deux = image(90, 777);
    const pdf = buildImagesPdf(
      [
        { jpeg: une, widthPx: 800, heightPx: 1100 },
        { jpeg: deux, widthPx: 600, heightPx: 900 },
      ],
      "épreuve",
    );
    const pages = pagesJpegDuPdf(await pdf.arrayBuffer());
    expect(pages).toHaveLength(2);
    expect(pages[0]!.type).toBe("image/jpeg");
    expect(new Uint8Array(await pages[0]!.arrayBuffer())).toEqual(une);
    expect(new Uint8Array(await pages[1]!.arrayBuffer())).toEqual(deux);
  });

  it("ne rend rien pour un PDF sans image de page", () => {
    const vide = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    );
    expect(pagesJpegDuPdf(vide)).toEqual([]);
  });

  it("ne se laisse pas tromper par une longueur qui dépasse le fichier", () => {
    const tronque = new TextEncoder().encode(
      "%PDF-1.7\n4 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length 99999 >>\nstream\nabc",
    );
    expect(pagesJpegDuPdf(tronque)).toEqual([]);
  });
});
