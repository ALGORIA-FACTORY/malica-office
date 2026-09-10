import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken } from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

/**
 * ================================================================ LE BANC
 *
 * Les pièces qui ont pris le produit en défaut deviennent des cas, et y
 * restent. Une correction sans son cas au banc se réintroduit à la première
 * refonte — c'est arrivé, et c'est pour cela que ce fichier existe.
 *
 * Chaque cas porte l'identifiant de la pièce sur staging, pour qu'on puisse
 * retrouver l'original et vérifier que le banc ne s'est pas mis à raconter
 * une histoire plus commode que la réalité.
 */

const jeton = (ordinal: number, text: string): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0: 0.1,
  y0: 0.1 + ordinal / 100,
  x1: 0.3,
  y1: 0.12 + ordinal / 100,
});

const ref = (ordinal: number) => ({ page: 1, ordinal });

const selection = (totals: {
  base_ht?: { page: number; ordinal: number } | null;
  vat?: { page: number; ordinal: number } | null;
  ttc?: { page: number; ordinal: number } | null;
}): VisionSelection =>
  ({
    issuer: null,
    document_date: null,
    currency: "TND",
    document_kind: "facture_achat",
    lines: [],
    articles: [],
    other_charges: [],
    totals: { base_ht: null, vat: null, ttc: null, ...totals },
    references: {},
    overall_confidence: 0.5,
  }) as unknown as VisionSelection;

const drapeau = (r: ReturnType<typeof buildExtractFromTokenPlan>, champ: string) =>
  r.flags.find((f) => f.field === champ);

describe("banc des factures — pièce 286ea66b, ticket MOKA", () => {
  // Le ticket porte « 2.800 » et rien d'autre : aucune équation ne peut
  // départager 2,800 D de 2 800 D. La version précédente lisait 2 800 D.
  const lu = buildExtractFromTokenPlan({
    tokens: [jeton(0, "TOTAL"), jeton(1, "2.800")],
    selection: selection({ ttc: ref(1) }),
    decimals: 3,
  });

  it("ne tranche pas ce que la pièce ne dit pas", () => {
    assert.equal(drapeau(lu, "totals.ttc")?.code, "SEPARATEUR_AMBIGU");
  });

  it("n'écrit aucune des deux lectures tant qu'elle hésite", () => {
    const ttc = (lu.extract["totals"] as Record<string, string>)["ttc"];
    assert.notEqual(ttc, "2800.000", "l'ancienne règle lisait 2 800 dinars");
    assert.notEqual(ttc, "2.800", "et l'autre lecture n'est pas plus fondée");
  });

  it("dit les deux lectures, pour que l'écran pose la question", () => {
    const detail = drapeau(lu, "totals.ttc")?.detail ?? "";
    assert.ok(detail.includes("2.800"), `le détail doit citer le texte lu : ${detail}`);
    assert.ok(detail.includes("2800.000"), `le détail doit citer les deux lectures : ${detail}`);
  });
});

describe("banc des factures — pièce b97ed23c, manuscrit ABDERRAHIM", () => {
  // Deux montants sans séparateur, aucune quantité, aucune TVA : rien à
  // faire boucler. Les deux restent à confirmer.
  const lu = buildExtractFromTokenPlan({
    tokens: [jeton(0, "16000"), jeton(1, "44400")],
    selection: selection({ base_ht: ref(0), ttc: ref(1) }),
    decimals: 3,
  });

  it("laisse les deux montants à confirmer", () => {
    assert.equal(drapeau(lu, "totals.base_ht")?.code, "SEPARATEUR_AMBIGU");
    assert.equal(drapeau(lu, "totals.ttc")?.code, "SEPARATEUR_AMBIGU");
  });
});

describe("banc des factures — l'exemple de l'étude", () => {
  // 1.200, 228, 1.428 : trois montants dont aucun n'est décidable seul. Une
  // seule affectation vérifie HT + TVA = TTC, et elle les décide tous les trois.
  const lu = buildExtractFromTokenPlan({
    tokens: [jeton(0, "1.200"), jeton(1, "228"), jeton(2, "1.428")],
    selection: selection({ base_ht: ref(0), vat: ref(1), ttc: ref(2) }),
    decimals: 3,
  });

  it("l'arithmétique décide les trois montants", () => {
    const totals = lu.extract["totals"] as Record<string, string>;
    assert.equal(totals["base_ht"], "1200.000");
    assert.equal(totals["vat"], "228.000");
    assert.equal(totals["ttc"], "1428.000");
  });

  it("dit que c'est l'arithmétique qui a décidé, pas la lecture", () => {
    assert.equal(drapeau(lu, "totals.base_ht")?.code, "DECIDE_PAR_ARITHMETIQUE");
    assert.equal(drapeau(lu, "totals.ttc")?.code, "DECIDE_PAR_ARITHMETIQUE");
  });

  it("ne drapeaute pas le montant que sa seule lecture suffisait à fixer", () => {
    assert.equal(drapeau(lu, "totals.vat"), undefined);
  });
});
