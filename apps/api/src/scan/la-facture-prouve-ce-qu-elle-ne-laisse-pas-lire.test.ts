/**
 * Ce que la facture prouve, sans le laisser lire.
 *
 * 30 octobre 2026, le dirigeant : « le Socle doit PROPOSER, et être EXACT ».
 * Une TVA, une base de ligne ou un timbre illisibles privaient la pièce
 * d'écriture, alors que la facture imprimait de quoi les PROUVER. Chaque
 * déduction a ici son cas positif — la valeur, la formule, les opérandes
 * cités — et ses cas négatifs : quand l'arithmétique ne ferme pas, ou ferme
 * sur deux inconnues à la fois, rien n'est rendu.
 *
 *   node --experimental-strip-types --test src/scan/la-facture-prouve-ce-qu-elle-ne-laisse-pas-lire.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deviseDEssai } from "./devise-d-essai.ts";
import { normaliserMontants } from "./normaliser-montants.ts";

const P = { ...deviseDEssai(3), toleranceMineure: 1 };
/** Le timbre, fixé par le paramétrage à 1,000. */
const TIMBRE = { brut: "1,000", attendu: 1_000 };

describe("la TVA illisible", () => {
  it("TTC − HT − droits, quand HT × taux la vérifie : déduite, et dite", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "1 234,560", taux: "0.19" }],
        tva: "Z34,566",
        autres: [TIMBRE],
        ttc: "1 470,126",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.tva, 234_566);
    const [d] = r.deduits;
    assert.equal(d?.champ, "totals.vat");
    assert.equal(d?.valeur, "234.566");
    assert.match(d!.formule, /TTC − HT − droits/);
    assert.equal(d?.operandes["ttc"], "1 470,126");
    assert.equal(d?.operandes["imprime"], "Z34,566");
  });

  it("l'écart n'est pas celui du taux : rien n'est rendu", () => {
    // 1 000 × 19 % = 190 ; 1 250 − 1 000 = 250. Une TVA de 250 serait inventée.
    const r = normaliserMontants(
      { bases: [{ ht: "1 000,000", taux: "0.19" }], tva: "Z90,000", ttc: "1 250,000" },
      P,
    );
    assert.notEqual(r.etat, "tranche", r.raison);
    assert.equal(r.montants.tva, null);
    assert.deepEqual(r.deduits, []);
  });

  it("deux inconnues — la TVA et le timbre — ne se déduisent pas l'une par l'autre", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "1 234,560", taux: "0.19" }],
        tva: "Z34,566",
        autres: [{ brut: "1,OOO", attendu: 1_000 }],
        ttc: "1 470,126",
      },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
    assert.deepEqual(r.deduits, []);
  });
});

describe("le droit fixé, illisible ou non cité", () => {
  it("non cité : TTC − HT − TVA vaut exactement le timbre du paramétrage", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "1 234,560", taux: "0.19" }],
        tva: "234,566",
        autres: [{ brut: null, attendu: 1_000 }],
        ttc: "1 470,126",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.deepEqual(r.montants.autres, [1_000]);
    assert.equal(r.deduits[0]?.champ, "other_charges[0].amount");
    assert.equal(r.deduits[0]?.valeur, "1.000");
  });

  it("illisible : même preuve", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "1 234,560", taux: "0.19" }],
        tva: "234,566",
        autres: [{ brut: "1,OOO", attendu: 1_000 }],
        ttc: "1 470,126",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.deduits[0]?.operandes["imprime"], "1,OOO");
  });

  it("le reste n'est pas le timbre, ne serait-ce que d'un millime : rien n'est rendu", () => {
    for (const ttc of ["1 471,126", "1 470,127"]) {
      const r = normaliserMontants(
        {
          bases: [{ ht: "1 234,560", taux: "0.19" }],
          tva: "234,566",
          autres: [{ brut: null, attendu: 1_000 }],
          ttc,
        },
        P,
      );
      assert.notEqual(r.etat, "tranche", `${ttc} : ${r.raison}`);
      assert.deepEqual(r.deduits, []);
    }
  });

  it("sans TVA lue, le reste ne départage rien : rien n'est rendu", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "1 234,560", taux: "0.19" }],
        autres: [{ brut: null, attendu: 1_000 }],
        ttc: "1 470,126",
      },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
  });

  it("un droit que le paramétrage ne fixe pas ne se déduit jamais", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "1 234,560", taux: "0.19" }],
        tva: "234,566",
        autres: [{ brut: null }],
        ttc: "1 470,126",
      },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
    assert.match(r.raison, /droit hors TVA n'est pas cité/);
  });
});

describe("la base d'une ligne, sur une facture à plusieurs taux", () => {
  const ENTREE = {
    bases: [
      { ht: "864,700", taux: "0.07" },
      { ht: "2 6g6,600", taux: "0.19" },
    ],
    tva: "572,883",
    autres: [TIMBRE],
    ttc: "4 135,183",
  };

  it("HT du pied − autres bases, quand la TVA et le TTC la vérifient", () => {
    const r = normaliserMontants({ ...ENTREE, htTotal: "3 561,300" }, P);
    assert.equal(r.etat, "tranche", r.raison);
    assert.deepEqual(
      r.montants.bases.map((b) => b.ht),
      [864_700, 2_696_600],
    );
    assert.equal(r.deduits[0]?.champ, "lines[1].base_ht");
    assert.equal(r.deduits[0]?.valeur, "2696.600");
  });

  it("un HT du pied que la TVA contredit : rien n'est rendu", () => {
    const r = normaliserMontants({ ...ENTREE, htTotal: "3 600,000" }, P);
    assert.notEqual(r.etat, "tranche", r.raison);
    assert.deepEqual(r.deduits, []);
  });

  it("sans HT du pied : la base reste illisible", () => {
    const r = normaliserMontants(ENTREE, P);
    assert.equal(r.etat, "illisible", r.raison);
  });

  it("deux bases illisibles ne se ventilent pas", () => {
    const r = normaliserMontants(
      {
        ...ENTREE,
        bases: [
          { ht: "86g,700", taux: "0.07" },
          { ht: "2 6g6,600", taux: "0.19" },
        ],
        htTotal: "3 561,300",
      },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
  });
});

describe("une facture qui se lit entièrement ne déduit rien", () => {
  it("aucune déduction, aucune réserve de plus", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "1 234,560", taux: "0.19" }],
        tva: "234,566",
        autres: [TIMBRE],
        ttc: "1 470,126",
      },
      P,
    );
    assert.equal(r.etat, "tranche");
    assert.deepEqual(r.deduits, []);
  });
});
