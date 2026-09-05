import { describe, expect, it } from "vitest";

import { extrairePagesScannees } from "../pdf-image.server";
import { readPdfTextLayer } from "../pdf-text.server";

/**
 * ============================================== LE DÉFAUT QUE CECI VERROUILLE
 *
 * « Cannot transfer object of unsupported type. »
 *
 * Ce message, en anglais, s'affichait sur le téléphone d'un dirigeant de PME à
 * chaque tentative de lecture. Seize pièces capturées, une seule lue.
 *
 * Il ne venait ni du navigateur, ni de Safari, ni de pdf.js. C'est la phrase
 * EXACTE que Node 24 prononce quand on transfère un `ArrayBuffer` DÉJÀ
 * transféré, donc détaché :
 *
 *   structuredClone({b}, {transfer:[b]});   // ok, b est détaché
 *   structuredClone({b}, {transfer:[b]});   // DataCloneError
 *
 * Or `getDocument({ data })` TRANSFÈRE les octets au moteur de pdf.js. La
 * lecture d'une pièce appelait pdf.js DEUX fois sur le même tableau :
 *
 *   readPdfTextLayer(bytes)        →  détache
 *   extrairePagesScannees(bytes)   →  explose
 *
 * Le même défaut avait déjà été trouvé et corrigé dans la visionneuse du
 * navigateur, et son commentaire d'en-tête l'explique depuis des semaines.
 * Le serveur portait la même faute, jamais vue — parce qu'aucune épreuve ne
 * faisait passer les mêmes octets deux fois.
 *
 * C'est cette épreuve-là.
 */

/** Un PDF d'une page, valide, avec sa table d'adressage exacte. */
function pdfMinimal(): Uint8Array {
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const contenu = "BT /F1 24 Tf 70 750 Td (FACTURE 2026-014) Tj ET\n";
  objets[3] = `<< /Length ${contenu.length} >>\nstream\n${contenu}endstream`;

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  objets.forEach((corps, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${corps}\nendobj\n`;
  });
  const debut = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${debut}\n%%EOF\n`;

  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) out[i] = pdf.charCodeAt(i) & 0xff;
  return out;
}

describe("lire une pièce, comme le fait la lecture réelle", () => {
  it("supporte de passer les MÊMES octets à pdf.js deux fois", async () => {
    const octets = pdfMinimal();

    // Exactement l'enchaînement de `relever()` : la couche de texte, puis les
    // images incrustées, sur le même tableau.
    const couche = await readPdfTextLayer(octets);
    expect(couche).toBeDefined();

    // Avant la correction, cette ligne levait :
    //   DataCloneError: Cannot transfer object of unsupported type.
    const pages = await extrairePagesScannees(octets);
    expect(Array.isArray(pages)).toBe(true);
  });

  it("laisse les octets d'origine intacts", async () => {
    // Un appelant doit pouvoir relire ses propres octets après coup : les
    // détacher dans son dos est une surprise, et c'est celle qui a coûté
    // seize pièces non lues.
    const octets = pdfMinimal();
    const taille = octets.length;
    await readPdfTextLayer(octets);
    expect(octets.length).toBe(taille);
    expect(octets.byteLength).toBe(taille);
  });
});
