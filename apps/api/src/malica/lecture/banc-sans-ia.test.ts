/**
 * Le banc sans IA compte juste : ses conversions de la vérité, et son rapport.
 * Le banc lui-même tourne contre une base et l'OCR (voir l'en-tête du module).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dateIso, enUnites, rapport, type MesureDeLaPiece } from "./banc-sans-ia.ts";

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
    assert.match(r, /\| tous les champs \| 1 \| 1 \| 1 \| 0 \| 0 \| 33\.3 % \|/u);
    assert.match(r, /échangés : 1/u);
  });
});
