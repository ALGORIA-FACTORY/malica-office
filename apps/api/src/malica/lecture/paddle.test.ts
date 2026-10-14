/**
 * Le second lecteur : ce qu'il rend, et ce qu'il refuse de casser.
 *
 * Les réponses du service sont celles qu'il a réellement rendues sur la
 * facture du 11 octobre, relevées le 13 — texte et boîtes compris.
 *
 *   node --experimental-strip-types --test src/malica/lecture/paddle.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";

import { lireAvecPaddle, secondLecteurDisponible } from "./paddle.ts";

const vraiFetch = globalThis.fetch;
const ancienneUrl = process.env["OCR_URL"];

/** Un service qui répond ce qu'on lui dit, sans réseau. */
function serviceQuiRend(corps: unknown, ok = true) {
  globalThis.fetch = (async () =>
    ({
      ok,
      json: async () => corps,
    }) as unknown as Response) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = vraiFetch;
  if (ancienneUrl === undefined) delete process.env["OCR_URL"];
  else process.env["OCR_URL"] = ancienneUrl;
});

describe("le second lecteur", () => {
  it("sans OCR_URL, il n'existe pas — et ce n'est pas une panne", async () => {
    /*
     * Le jour où le service n'est pas déployé, ou tombe, la chaîne doit se
     * comporter exactement comme avant. Une lecture partielle reste une
     * lecture partielle ; elle ne devient pas une erreur.
     */
    delete process.env["OCR_URL"];
    assert.equal(secondLecteurDisponible(), false);
    assert.equal(await lireAvecPaddle(new Uint8Array([1, 2, 3]), 1), null);
  });

  it("une ligne devient des MOTS, situés dans la page", async () => {
    process.env["OCR_URL"] = "http://ocr:8000";
    serviceQuiRend({
      lignes: [
        { texte: "NET À PAYER (DT)", boite: [0.52, 0.71, 0.78, 0.74], confiance: 1 },
        { texte: "4 135,183", boite: [0.8, 0.71, 0.93, 0.74], confiance: 1 },
      ],
      modele: "PP-OCRv5_mobile_det+latin_PP-OCRv5_mobile_rec",
      millisecondes: 21300,
    });

    const r = await lireAvecPaddle(new Uint8Array([1]), 1);
    assert.ok(r);
    // Quatre mots pour la première ligne, deux pour la seconde.
    assert.deepEqual(
      r.tokens.map((t) => t.text),
      ["NET", "À", "PAYER", "(DT)", "4", "135,183"],
    );
    // Les ordinaux se suivent sans trou : c'est par eux que la désignation
    // pointe un montant, et un trou ferait pointer à côté.
    assert.deepEqual(
      r.tokens.map((t) => t.ordinal),
      [0, 1, 2, 3, 4, 5],
    );
    assert.equal(
      r.tokens.every((t) => t.page === 1),
      true,
    );
  });

  it("le « 4 » que l'ancienne chaîne lisait « + » est bien là", async () => {
    // Le défaut qui a tout déclenché, réduit à une assertion.
    process.env["OCR_URL"] = "http://ocr:8000";
    serviceQuiRend({
      lignes: [{ texte: "4 135,183", boite: [0.8, 0.71, 0.93, 0.74], confiance: 1 }],
    });
    const r = await lireAvecPaddle(new Uint8Array([1]), 1);
    assert.deepEqual(
      r!.tokens.map((t) => t.text),
      ["4", "135,183"],
    );
  });

  it("la confiance de la ligne se pose sur chacun de ses mots", async () => {
    /*
     * Aucun producteur ne remplissait `confidence` : `confiance.ts` lisait
     * donc toujours 1, et la confiance par champ se réduisait à celle de la
     * désignation. Le second lecteur est le premier à faire vivre cette
     * branche.
     */
    process.env["OCR_URL"] = "http://ocr:8000";
    serviceQuiRend({
      lignes: [{ texte: "Total HT", boite: [0.1, 0.2, 0.3, 0.22], confiance: 0.93 }],
    });
    const r = await lireAvecPaddle(new Uint8Array([1]), 1);
    assert.equal(
      r!.tokens.every((t) => t.confidence === 0.93),
      true,
    );
  });

  it("les coordonnées restent dans la page, même si le service déborde", async () => {
    process.env["OCR_URL"] = "http://ocr:8000";
    serviceQuiRend({ lignes: [{ texte: "Total", boite: [-0.5, -1, 2, 3], confiance: 1 }] });
    const r = await lireAvecPaddle(new Uint8Array([1]), 1);
    const t = r!.tokens[0]!;
    assert.ok(t.x0 >= 0 && t.x1 <= 1 && t.y0 >= 0 && t.y1 <= 1);
  });

  it("une boîte absurde est ignorée, pas devinée", async () => {
    process.env["OCR_URL"] = "http://ocr:8000";
    serviceQuiRend({
      lignes: [
        { texte: "illisible", boite: [NaN, 0, 1, 1], confiance: 1 },
        { texte: "Total", boite: [0.1, 0.2, 0.3, 0.22], confiance: 1 },
      ],
    });
    const r = await lireAvecPaddle(new Uint8Array([1]), 1);
    assert.deepEqual(
      r!.tokens.map((t) => t.text),
      ["Total"],
    );
  });

  it("un service en panne rend `null`, jamais une exception", async () => {
    process.env["OCR_URL"] = "http://ocr:8000";
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    assert.equal(await lireAvecPaddle(new Uint8Array([1]), 1), null);
  });

  it("la premiere couche n'est pas la premiere pour un PDF qui porte son texte", async () => {
    /*
     * 14 octobre 2026 : « Paddle en premiere couche ». Oui — mais apres la
     * couche de texte d'un PDF, qui reste intouchable.
     *
     * Un PDF emis par un logiciel porte son texte EXACT. Aucune
     * reconnaissance d'image, si bonne soit-elle, ne peut faire mieux que de
     * recopier ce qui est deja ecrit ; elle peut seulement faire moins bien.
     * Cette epreuve lit le code pour que l'ordre ne s'inverse pas par
     * distraction.
     */
    const source = readFileSync(resolve(process.cwd(), "src/malica/lecture/vision.ts"), "utf8");
    const coucheTexte = source.indexOf("readPdfTextLayer(params.bytes)");
    const premierPaddle = source.indexOf("releverDesPages(pages");
    assert.ok(coucheTexte > 0 && premierPaddle > 0);
    assert.ok(
      coucheTexte < premierPaddle,
      "la couche de texte du PDF doit etre tentee AVANT le second lecteur",
    );
  });

  it("un service qui refuse, ou qui ne trouve rien, rend `null` aussi", async () => {
    process.env["OCR_URL"] = "http://ocr:8000";
    serviceQuiRend({ lignes: [] }, false);
    assert.equal(await lireAvecPaddle(new Uint8Array([1]), 1), null);
    serviceQuiRend({ lignes: [] });
    assert.equal(await lireAvecPaddle(new Uint8Array([1]), 1), null);
  });
});
