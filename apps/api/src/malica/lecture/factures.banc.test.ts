import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
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
  base_ht?: TokenRef | null;
  vat?: TokenRef | null;
  ttc?: TokenRef | null;
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

describe("banc des factures — aucun chiffre inventé (3B, 18 septembre 2026)", () => {
  // Un total illisible était écrit « 0 », un émetteur ou une date illisibles
  // « » : un zéro qui n'est imprimé nulle part passait la validation du contrat
  // et pouvait finir dans une proposition d'écriture. Un champ illisible reste
  // VIDE ; la lecture se dit alors partielle.
  const lu = buildExtractFromTokenPlan({
    tokens: [jeton(0, "FACTURE")],
    selection: selection({}),
    decimals: 3,
  });
  const extrait = lu.extract as {
    issuer: unknown;
    document_date: unknown;
    totals: Record<string, unknown>;
  };

  it("un total illisible reste vide, jamais « 0 »", () => {
    assert.deepEqual(extrait.totals, { base_ht: null, vat: null, ttc: null });
  });

  it("un émetteur et une date illisibles restent vides, jamais « »", () => {
    assert.equal(extrait.issuer, null);
    assert.equal(extrait.document_date, null);
  });

  it("et la lecture se dit partielle", () => {
    assert.equal(lu.contract, "extract.v1.partiel");
    assert.equal(lu.valid, false);
  });
});

describe("banc des factures — pièce 73ae6059, le loyer tronqué (5 octobre 2026)", () => {
  /*
   * Les trois montants EXACTEMENT comme ils sont sortis en production, le
   * 4 octobre, sur une facture dont le papier portait 3 020,000 / 573,800 /
   * 3 594,800. Chaque montant coupé par l'espace des milliers a été réduit à
   * son premier jeton.
   *
   * Aucun de ces trois nombres n'est ambigu : « 3 » a une lecture unique. Tous
   * les drapeaux du produit visaient l'ambiguïté, donc aucun ne s'est levé, et
   * la pièce est partie avec HT 3,000, TVA 573,800, TTC 3,000.
   *
   * 3,000 + 573,800 ne fait pas 3,000. C'est ce que ce cas exige de voir.
   */
  const lu = buildExtractFromTokenPlan({
    tokens: [jeton(0, "3"), jeton(1, "573,800"), jeton(2, "3")],
    selection: selection({ base_ht: ref(0), vat: ref(1), ttc: ref(2) }),
    decimals: 3,
  });

  it("dit que la facture ne boucle pas", () => {
    const incoherence = drapeau(lu, "totals.ttc");
    assert.equal(incoherence?.code, "ARITHMETIQUE_INCOHERENTE");
  });

  it("montre les deux nombres, pas un reproche vague", () => {
    // « La facture ne tient pas » n'apprend rien à qui doit la corriger. Le
    // détail doit porter ce que l'équation donne et ce que la pièce imprime :
    // c'est l'écart qui désigne le montant à relire.
    const detail = drapeau(lu, "totals.ttc")?.detail ?? "";
    assert.match(detail, /576\.800/, `l'équation donne 576,800 : ${detail}`);
    assert.match(detail, /3\.000/, `la pièce porte 3,000 : ${detail}`);
  });

  it("ne confond pas incohérence et ambiguïté", () => {
    // Le drapeau d'ambiguïté dit « je ne sais pas lire ». Celui-ci dit « je
    // sais lire, et ce que je lis ne tient pas ». Les deux gestes de
    // correction sont différents, donc les deux drapeaux doivent l'être.
    assert.notEqual(drapeau(lu, "totals.ttc")?.code, "SEPARATEUR_AMBIGU");
  });
});

describe("banc des factures — le timbre appartient à l'équation (5 octobre 2026)", () => {
  /*
   * La même facture, lue JUSTE. Son arithmétique boucle au millime :
   *
   *   3 020,000 + 573,800 + 1,000 (timbre) = 3 594,800
   *
   * L'équation du produit était « TTC = HT + TVA », sans les droits hors TVA.
   * Elle tombait à 3 593,800 : toute facture tunisienne portant un timbre —
   * c'est-à-dire presque toutes — violait donc une contrainte du solveur.
   *
   * Sans ce cas, le garde posé le 5 octobre aurait crié sur des pièces
   * valides. Un garde qui crie à tort est pire qu'un garde muet : on apprend
   * à l'ignorer, et il ne protège plus de rien.
   */
  const lu = buildExtractFromTokenPlan({
    tokens: [
      jeton(0, "3"),
      jeton(1, "020,000"),
      jeton(2, "573,800"),
      jeton(3, "1,000"),
      jeton(4, "3"),
      jeton(5, "594,800"),
    ],
    selection: {
      ...selection({
        base_ht: { page: 1, ordinal: 0, ordinalEnd: 1 },
        vat: ref(2),
        ttc: { page: 1, ordinal: 4, ordinalEnd: 5 },
      }),
      other_charges: [{ code: "DROIT_TIMBRE", amount: ref(3) }],
    } as unknown as VisionSelection,
    decimals: 3,
  });

  it("lit les montants coupés par l'espace des milliers", () => {
    const totals = lu.extract["totals"] as Record<string, string>;
    assert.equal(totals["base_ht"], "3020.000");
    assert.equal(totals["ttc"], "3594.800");
  });

  it("ne crie pas : HT + TVA + timbre = TTC", () => {
    assert.equal(drapeau(lu, "totals.ttc")?.code, undefined);
  });
});
