/**
 * Le banc sans IA compte juste : ses conversions de la vérité, et son rapport.
 * Le banc lui-même tourne contre une base et l'OCR (voir l'en-tête du module).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dateIso,
  enUnites,
  gardeDuReleve,
  lecteurDuBanc,
  plafonnerLesAppels,
  rapport,
  releveAccepte,
  type MesureDeLaPiece,
} from "./banc-sans-ia.ts";

describe("banc sans IA — la vérité, convertie sans flottant", () => {
  it("un montant décimal en unités de l'exposant, chiffres orientaux compris", () => {
    assert.equal(enUnites("841.849", 3), 841849n);
    assert.equal(enUnites("385", 3), 385000n);
    assert.equal(enUnites("٨٤١.٨٤٩", 3), 841849n);
    assert.equal(
      enUnites("1.0001", 3),
      null,
      "une précision que la devise n'a pas n'est pas un montant",
    );
    assert.equal(enUnites("abc", 3), null);
  });

  it("une date de la vérité en ISO", () => {
    assert.equal(dateIso("08/08/2026"), "2026-08-08");
    assert.equal(dateIso("2026-02-04"), "2026-02-04");
  });
});

describe("banc sans IA — le rapport", () => {
  const piece = (id: string, issues: MesureDeLaPiece["champs"]): MesureDeLaPiece => ({
    corpus: "essai",
    id,
    type: "facture_achat",
    grille: "facture",
    rendu: "pdf",
    langue: "fr",
    gabarit: null,
    lecteur: "pdf-text",
    releveMs: 1,
    sudokuMs: 1,
    issue: "prouvee",
    raison: null,
    sens: { attendu: "achat", lu: "vente", juste: false, raison: null },
    champs: issues,
  });

  it("compte juste / faux / silence / inventé, et nomme l'échange de parties", () => {
    const r = rapport([
      piece("1", [
        { champ: "total_ht", expert: "montant", issue: "juste", attendu: "1", lu: "1000" },
        { champ: "total_ttc", expert: "montant", issue: "faux", attendu: "2", lu: "1000" },
        {
          champ: "date_emission",
          expert: "date",
          issue: "silence",
          attendu: "2026-01-01",
          lu: null,
        },
      ]),
    ]);
    assert.match(r, /\| tous les champs \| 1 \| 1 \| 1 \| 0 \| 1 \| 0 \| 0 \| 33\.3 % \|/u);
    assert.match(r, /échangés : 1/u);
  });
});

describe("banc sans IA — le lecteur Qwen, choisi et jamais par repli", () => {
  const cles = { QWEN_API_KEY: "k", QWEN_BASE_URL: "https://exemple.invalid" };

  it("PaddleOCR par défaut ; Qwen seulement demandé, et avec ses deux clés", () => {
    assert.equal(lecteurDuBanc(undefined, {}), "paddle");
    assert.equal(lecteurDuBanc("paddle", cles), "paddle");
    assert.equal(lecteurDuBanc("qwen", cles), "qwen");
    assert.throws(() => lecteurDuBanc("qwen", {}), /QWEN_API_KEY, QWEN_BASE_URL/u);
    assert.throws(() => lecteurDuBanc("qwen", { ...cles, QWEN_BASE_URL: " " }), /QWEN_BASE_URL/u);
    assert.throws(() => lecteurDuBanc("mistral", cles), /lecteur inconnu/u);
  });

  it("un relevé d'un autre lecteur est refusé ; la couche de texte passe devant les deux", () => {
    assert.equal(releveAccepte("vision", "qwen"), true);
    assert.equal(releveAccepte("paddle", "qwen"), false, "Qwen demandé, PaddleOCR rendu : panne");
    assert.equal(releveAccepte("vision", "paddle"), false);
    assert.equal(releveAccepte("paddle", "paddle"), true);
    assert.equal(releveAccepte("pdf-text", "qwen"), true);
    assert.equal(releveAccepte("pdf-text", "paddle"), true);
  });

  it("les relevés de Qwen se gardent à part de ceux de PaddleOCR", () => {
    assert.equal(gardeDuReleve("/c", "algoria-001", "paddle"), "/c/algoria-001.json");
    assert.equal(gardeDuReleve("/c", "algoria-001", "qwen"), "/c/algoria-001.qwen.json");
  });

  it("au-delà du plafond, l'appel n'est pas émis", async () => {
    let emis = 0;
    const origine = (() => {
      emis += 1;
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch;
    const p = plafonnerLesAppels(2, origine);
    await p.fetch("https://exemple.invalid/1");
    await p.fetch("https://exemple.invalid/2");
    await assert.rejects(p.fetch("https://exemple.invalid/3"), /plafond d'appels atteint \(2\)/u);
    assert.equal(emis, 2);
    assert.equal(p.appels(), 2);
  });
});
