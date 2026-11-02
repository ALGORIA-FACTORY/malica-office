import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { devisesDEssai } from "../../scan/devise-d-essai.ts";
import { REGLES_DE_LECTURE_D_ESSAI } from "../../scan/referentiel-d-essai.ts";

import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

/**
 * ============================================ LE TOTAL QUE SEULES LES LETTRES DONNENT
 *
 * 2 novembre 2026, une photo de facture : « 510,000 » relevé « 810,000 », et
 * « Cinq Cent Dix Dinars » écrit sous les totaux. Le sudoku ferme la pièce par
 * le montant en lettres et cite cette phrase comme total. La lecture recompose
 * alors le TTC par le Socle — HT + TVA + droits — seulement si la phrase lue en
 * lettres vaut exactement cette somme. Le plan est synthétique (aucune donnée
 * réelle n'entre dans ce dépôt).
 */

const jeton = (ordinal: number, texte: string, x: number, y: number): PageToken => ({
  page: 1,
  ordinal,
  text: texte,
  x0: x,
  y0: y,
  x1: x + 0.1,
  y1: y + 0.014,
});

const PIED: PageToken[] = [
  jeton(0, "427,731", 0.3, 0.63),
  jeton(1, "81,269", 0.55, 0.63),
  jeton(2, "1,000", 0.8, 0.66),
  jeton(3, "Cinq", 0.26, 0.8),
  jeton(4, "Cent", 0.37, 0.8),
  jeton(5, "Dix", 0.48, 0.8),
  jeton(6, "Dinars.", 0.59, 0.8),
  jeton(7, "Six", 0.26, 0.9),
  jeton(8, "Cents", 0.37, 0.9),
  jeton(9, "Dinars", 0.48, 0.9),
];

const ref = (ordinal: number, ordinalEnd?: number): TokenRef =>
  ordinalEnd === undefined ? { page: 1, ordinal } : { page: 1, ordinal, ordinalEnd };

const lire = (ttc: TokenRef) =>
  buildExtractFromTokenPlan({
    tokens: PIED,
    selection: {
      issuer: null,
      document_date: null,
      currency: "TND",
      document_kind: "facture_achat",
      lines: [
        { label: "TVA 19%", tax_code: "TVA19", base_ht: ref(0), vat_amount: ref(1), ttc: null },
      ],
      articles: [],
      other_charges: [{ code: "DROIT_TIMBRE", amount: ref(2) }],
      references: {},
      overall_confidence: 0.5,
      totals: { base_ht: ref(0), vat: ref(1), ttc },
    } as unknown as VisionSelection,
    ...devisesDEssai(3),
    matriculeDossier: null,
    regles: REGLES_DE_LECTURE_D_ESSAI,
  });

describe("le total cité en lettres", () => {
  it("se recompose quand les lettres valent HT + TVA + droits", () => {
    const lu = lire(ref(3, 6));
    const totaux = lu.extract["totals"] as Record<string, string | null>;
    assert.equal(totaux["ttc"], "510.000");
    const f = lu.flags.find((x) => x.field === "totals.ttc" && x.code === "DERIVED_BY_SOCLE");
    assert.match(f?.detail ?? "", /Cinq Cent Dix Dinars/);
  });

  it("reste vide quand les lettres disent autre chose", () => {
    const lu = lire(ref(7, 9));
    const totaux = lu.extract["totals"] as Record<string, string | null>;
    assert.equal(totaux["ttc"], null);
    assert.equal(lu.contract, "extract.v1.partiel");
  });
});
