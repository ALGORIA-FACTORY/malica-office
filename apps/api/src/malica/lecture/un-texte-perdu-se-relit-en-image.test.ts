/**
 * Une couche de texte qui a perdu ses mots ne se croit pas : la page se relit
 * en image.
 *
 * Jeu synthétique, 31 octobre 2026 (cas 047) : un avoir arabe imprimé par
 * Chromium recevait une écriture d'ACHAT. Sa couche de texte ne porte aucun
 * texte arabe exploitable — glyphes liés sans correspondance Unicode, formes
 * de présentation isolées —, et le titre « إشعار دائن » s'y relevait en
 * lettres détachées. Le relevé la croyait pourtant, parce qu'elle avait assez
 * de jetons.
 *
 * Le second lecteur est simulé (`fetch`) : on vérifie que la page lui part
 * DESSINÉE, en JPEG, et que le relevé dit qui l'a lue — jamais la couche.
 *
 *   node --experimental-strip-types --test src/malica/lecture/un-texte-perdu-se-relit-en-image.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { laCoucheSeCroit, relever } from "./vision.ts";
import { readPdfTextLayer } from "./pdf-text.ts";

const RENDUS = new URL("../../../../../outils/jeu-synthetique/rendus/", import.meta.url);
const octets = (nom: string) => new Uint8Array(readFileSync(new URL(nom, RENDUS)));

const vraiFetch = globalThis.fetch;
const ancienneUrl = process.env["OCR_URL"];

afterEach(() => {
  globalThis.fetch = vraiFetch;
  if (ancienneUrl === undefined) delete process.env["OCR_URL"];
  else process.env["OCR_URL"] = ancienneUrl;
});

describe("une couche de texte qui a perdu ses mots", () => {
  it("se reconnaît, page par page", async () => {
    // 047 : l'avoir arabe ; 005 : une facture française du même générateur.
    assert.deepEqual((await readPdfTextLayer(octets("047.pdf"))).pagesSansUnicode, [1]);
    assert.deepEqual((await readPdfTextLayer(octets("005.pdf"))).pagesSansUnicode, []);
  });

  it("ne se croit pas ; une couche intacte, si", async () => {
    assert.equal(laCoucheSeCroit(await readPdfTextLayer(octets("047.pdf"))), false);
    assert.equal(laCoucheSeCroit(await readPdfTextLayer(octets("005.pdf"))), true);
  });

  it("la page part dessinée au lecteur d'image, et le relevé le dit", async () => {
    process.env["OCR_URL"] = "http://ocr:8000";
    const recues: Uint8Array[] = [];
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      recues.push(init?.body as Uint8Array);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lignes: [{ texte: "إشعار دائن", boite: [0.1, 0.05, 0.4, 0.08], confiance: 0.98 }],
          modele: "paddleocr-essai",
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const pdf = octets("047.pdf");
    const r = await relever({
      dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
      mime: "application/pdf",
      bytes: pdf,
    });

    assert.equal(r.lecteur, "paddle");
    assert.equal(recues.length, 1, "une page, une image");
    // Une image JPEG (FF D8 FF), pas les octets du PDF.
    assert.deepEqual([...recues[0]!.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(r.tokens.some((t) => t.text === "دائن"));
  });
});
