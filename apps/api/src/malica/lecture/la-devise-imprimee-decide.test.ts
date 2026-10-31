/**
 * La devise imprimée décide, à la relecture comme au jugement.
 *
 * ================================================================= POURQUOI
 *
 * Revue de la PR 144 : « 100,00 € / 19,00 € / 119,00 € », sans devise lue,
 * partait au journal en 100,000 DINARS. Trois fautes s'additionnaient : la
 * sélection remplaçait la devise manquante par celle du dossier
 * (`raw.currency ?? devise`), la relecture lisait les montants à l'exposant du
 * dossier, et le lecteur retirait « € » comme une décoration sans dire de
 * quelle devise elle était. La devise de la pièce se décide désormais par
 * `deviseDeLaPiece`, ici et au jugement : une marque imprimée décide d'une
 * devise non lue, et contredit une devise lue.
 *
 *   node --experimental-strip-types --test src/malica/lecture/la-devise-imprimee-decide.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { devisesDEssai } from "../../scan/devise-d-essai.ts";

import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

const jeton = (ordinal: number, texte: string, y: number): PageToken => ({
  page: 1,
  ordinal,
  text: texte,
  x0: 0.6,
  y0: y,
  x1: 0.6 + texte.length * 0.012,
  y1: y + 0.014,
});
const ref = (ordinal: number): TokenRef => ({ page: 1, ordinal });

/** Le pied d'une facture en euros : HT, TVA, TTC, chacun avec sa marque. */
const PIED: PageToken[] = [
  jeton(0, "100,00 €", 0.6),
  jeton(1, "19,00 €", 0.65),
  jeton(2, "119,00 €", 0.7),
];

const lire = (currency: string | null) =>
  buildExtractFromTokenPlan({
    tokens: PIED,
    selection: {
      issuer: null,
      document_date: null,
      currency,
      document_kind: "facture_achat",
      lines: [],
      articles: [],
      other_charges: [],
      references: {},
      overall_confidence: 0.5,
      totals: { base_ht: ref(0), vat: ref(1), ttc: ref(2) },
    } as unknown as VisionSelection,
    ...devisesDEssai(3),
    matriculeDossier: null,
  });

describe("la devise imprimée décide", () => {
  it("aucune devise lue, des euros imprimés : la pièce est en euros, lue en centimes", () => {
    const lu = lire(null);
    assert.equal(lu.extract["currency"], "EUR");
    const totaux = lu.extract["totals"] as Record<string, string | null>;
    assert.deepEqual(
      [totaux["base_ht"], totaux["vat"], totaux["ttc"]],
      ["100.00", "19.00", "119.00"],
    );
    assert.equal(
      lu.flags.some((f) => f.code === "DEVISE_INCOHERENTE"),
      false,
    );
  });

  it("des dinars lus, des euros imprimés : la devise ne se décide pas, et le drapeau le dit", () => {
    const lu = lire("TND");
    const f = lu.flags.find((x) => x.code === "DEVISE_INCOHERENTE");
    assert.equal(f?.field, "currency");
    assert.match(f?.detail ?? "", /EUR.*≠.*TND/);
  });

  it("des euros lus et imprimés : rien à redire", () => {
    const lu = lire("EUR");
    assert.equal(lu.extract["currency"], "EUR");
    assert.equal(
      lu.flags.some((f) => f.code === "DEVISE_INCOHERENTE"),
      false,
    );
  });
});
