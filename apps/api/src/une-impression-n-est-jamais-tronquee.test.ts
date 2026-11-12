/**
 * Une impression n'est jamais incomplète sans le dire (relecture de #366, P1).
 *
 * La préparation compte les pages d'une pièce par son `page_count`. Un
 * original qui en porte plus que la base n'en sait ne doit pas être coupé en
 * silence à la borne : la composition s'arrête et le dit.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "@napi-rs/canvas";

import { composerLImpression, ImpressionTropVolumineuse } from "./impression-pdf.ts";

function unPdfDe(pages: number): Uint8Array {
  const doc = new PDFDocument();
  for (let i = 0; i < pages; i += 1) {
    const ctx = doc.beginPage(595, 842);
    ctx.fillRect(40, 40, 100, 100);
    doc.endPage();
  }
  return new Uint8Array(doc.close());
}

const composition = (pagesMax: number, pagesDeLOriginal: number) => ({
  societes: [
    {
      nom: "Atelier",
      matricule: null,
      periode: "11/2026",
      // La base croit la pièce d'une page.
      pieces: [
        {
          id: "p",
          reference: "FA-1",
          type: null,
          tiers: null,
          date: "01/11/2026",
          montant: null,
          pages: 1,
        },
      ],
    },
  ],
  mentions: {},
  sens: "ltr" as const,
  composeLe: "12/11/2026 10:00",
  pagesMax,
  charger: async () => unPdfDe(pagesDeLOriginal),
});

describe("une impression n'est jamais tronquée", () => {
  it("refuse un original qui dépasse la borne, au lieu d'en rendre une partie", async () => {
    // Garde + index + 5 pages = 7 > 4 : rien ne doit sortir.
    await assert.rejects(composerLImpression(composition(4, 5)), ImpressionTropVolumineuse);
  });

  it("rend toutes les pages d'un original plus long que ce que la base en sait, sous la borne", async () => {
    const { pages } = await composerLImpression(composition(7, 5));
    assert.equal(pages, 7);
  });
});
