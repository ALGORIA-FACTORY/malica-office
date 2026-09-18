/**
 * 3B-3 — La normalisation des montants : le point dur.
 *
 * La convention d'écriture d'un montant ne se devine pas sur un montant isolé.
 * « 2.800 » vaut deux dinars huit cents millimes — ou deux mille huit cents
 * dinars ; « 1234560 » est écrit en dinars, ou en millimes sans séparateur.
 * Elle se TRANCHE en vérifiant que la facture tient :
 *
 *     Σ HT × (1 + taux) + autres montants (timbre…) = TTC
 *
 * Le taux et la tolérance d'arrondi viennent du paramétrage daté, par
 * l'appelant ; la fonction ne porte aucune valeur fiscale.
 *
 *   node --experimental-strip-types --test src/scan/normaliser-montants.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { candidatsMontant, normaliserMontants } from "./normaliser-montants.ts";

/** Ce qui vient du paramétrage dans la vraie vie — ici, fixé par le test. */
const P = { decimales: 3, toleranceMineure: 1 };
const TAUX = "0.19";

// 1 234,560 × 1,19 = 1 469,1264 → TVA arrondie 234,566 → TTC 1 469,126.
const HT = 1_234_560; // en millimes
const TTC = 1_469_126;

describe("les dix écritures d'un même montant, tranchées par la facture", () => {
  const CAS: Array<[string, string]> = [
    ["1 234,560", "1 469,126"],
    ["1234.560", "1469.126"],
    ["1,234.560", "1,469.126"],
    ["1.234,560", "1.469,126"],
    ["1'234.560", "1'469.126"],
    ["1 234,56", "1 469,126"],
    ["1234,5600", "1469,1260"],
    ["1 234,560DT", "1 469,126DT"],
  ];
  for (const [ht, ttc] of CAS) {
    it(`HT « ${ht} », TTC « ${ttc} » → 1 234,560 / 1 469,126`, () => {
      const r = normaliserMontants({ bases: [{ ht, taux: TAUX }], ttc }, P);
      assert.equal(r.etat, "tranche", r.raison);
      assert.equal(r.montants.bases[0]!.ht, HT);
      assert.equal(r.montants.ttc, TTC);
      assert.ok(r.confiance > 0 && r.confiance <= 1);
    });
  }

  it("« 1 234 560 » et « 1234560 » : dinars ou millimes — le timbre tranche", () => {
    // Avec un timbre « 1,000 » — lui-même ambigu : 1 dinar, ou 1 000 à l'anglaise —,
    // une seule combinaison tient, la lecture en millimes :
    // 1 234,560 × 1,19 + 1,000 = 1 470,126.
    for (const [ht, ttc] of [
      ["1 234 560", "1 470 126"],
      ["1234560", "1470126"],
    ] as const) {
      const r = normaliserMontants({ bases: [{ ht, taux: TAUX }], autres: ["1,000"], ttc }, P);
      assert.equal(r.etat, "tranche", `${ht} : ${r.raison}`);
      assert.equal(r.montants.bases[0]!.ht, HT);
      assert.equal(r.montants.ttc, 1_470_126);
    }
  });

  it("un reste d'arrondi, lui, tranche l'échelle", () => {
    // Lu en dinars, 1 234 560 × 1,19 = 1 469 126,400 : les 400 millimes ne
    // tombent pas sur le TTC imprimé. Seule la lecture en millimes tient.
    const r = normaliserMontants({ bases: [{ ht: "1234560", taux: TAUX }], ttc: "1469126" }, P);
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, HT);
  });

  it("sans reste d'arrondi, dinars et millimes tiennent TOUS DEUX : aucun chiffre n'est rendu", () => {
    // 1 000,000 × 1,19 = 1 190,000 exactement : lue en dinars ou en millimes,
    // l'égalité tient pareil. L'arithmétique seule ne tranche pas l'échelle.
    const r = normaliserMontants({ bases: [{ ht: "1000000", taux: TAUX }], ttc: "1190000" }, P);
    assert.equal(r.etat, "ambigu");
    assert.equal(r.montants.bases[0]!.ht, null);
    assert.equal(r.montants.ttc, null);
    assert.equal(r.confiance, 0);
    assert.match(r.raison, /échelle|dinars|millimes/);
  });
});

describe("jamais deviné sur un montant isolé", () => {
  it("un montant ambigu, seul, ne rend aucune valeur", () => {
    const c = candidatsMontant("2.800", P.decimales);
    assert.equal(c.length, 2, "deux lectures : point décimal, point des milliers");
    const r = normaliserMontants({ bases: [{ ht: "2.800", taux: TAUX }] }, P);
    assert.equal(r.etat, "ambigu");
    assert.equal(r.montants.bases[0]!.ht, null);
  });

  it("un montant sans ambiguïté, seul, se lit — avec une confiance réduite : rien ne le vérifie", () => {
    const r = normaliserMontants({ bases: [{ ht: "1 234,560", taux: TAUX }] }, P);
    assert.equal(r.etat, "non_verifie");
    assert.equal(r.montants.bases[0]!.ht, HT);
    assert.ok(r.confiance < 1);
  });
});

describe("une facture qui ne tient pas", () => {
  it("aucune combinaison ne vérifie l'égalité : aucun chiffre, et la raison", () => {
    const r = normaliserMontants({ bases: [{ ht: "1 234,560", taux: TAUX }], ttc: "1 500,000" }, P);
    assert.equal(r.etat, "incoherent");
    assert.equal(r.montants.bases[0]!.ht, null);
    assert.equal(r.montants.ttc, null);
    assert.equal(r.confiance, 0);
    assert.match(r.raison, /TTC/);
  });

  it("un montant illisible reste vide, avec sa raison", () => {
    const r = normaliserMontants(
      { bases: [{ ht: "mille deux cents", taux: TAUX }], ttc: "1 469,126" },
      P,
    );
    assert.equal(r.etat, "illisible");
    assert.equal(r.montants.bases[0]!.ht, null);
    assert.match(r.raison, /illisible/);
  });
});

describe("la TVA imprimée, et plusieurs taux", () => {
  it("la TVA imprimée doit aussi tomber juste", () => {
    const bon = normaliserMontants(
      { bases: [{ ht: "1 234,560", taux: TAUX }], tva: "234,566", ttc: "1 469,126" },
      P,
    );
    assert.equal(bon.etat, "tranche");
    assert.equal(bon.montants.tva, 234_566);
    const faux = normaliserMontants(
      { bases: [{ ht: "1 234,560", taux: TAUX }], tva: "200,000", ttc: "1 469,126" },
      P,
    );
    assert.equal(faux.etat, "incoherent");
  });

  it("deux bases à deux taux, et le timbre", () => {
    // 1 000,000 × 1,19 + 500,000 × 1,07 + 1,000 = 1 190,000 + 535,000 + 1,000 = 1 726,000
    const r = normaliserMontants(
      {
        bases: [
          { ht: "1.000,000", taux: "0.19" },
          { ht: "500,000", taux: "0.07" },
        ],
        autres: ["1,000"],
        ttc: "1.726,000",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.deepEqual(
      r.montants.bases.map((b) => b.ht),
      [1_000_000, 500_000],
    );
    assert.equal(r.montants.ttc, 1_726_000);
  });

  it("la tolérance d'arrondi vient de l'appelant, pas de la fonction", () => {
    // 1 469,127 : un millime d'écart. Toléré à 1, refusé à 0.
    const entree = { bases: [{ ht: "1 234,560", taux: TAUX }], ttc: "1 469,127" };
    assert.equal(normaliserMontants(entree, { decimales: 3, toleranceMineure: 1 }).etat, "tranche");
    assert.equal(
      normaliserMontants(entree, { decimales: 3, toleranceMineure: 0 }).etat,
      "incoherent",
    );
  });
});

describe("les lectures d'un montant isolé", () => {
  const cas: Array<[string, number[]]> = [
    ["1 234,560", [1_234_560]],
    ["1,234.560", [1_234_560]],
    ["1.234,560", [1_234_560]],
    ["1'234.560", [1_234_560]],
    ["1 234,56", [1_234_560]],
    ["1234,5600", [1_234_560]],
    ["1 234,560DT", [1_234_560]],
    // Un premier groupe de quatre chiffres n'est pas un groupe de milliers :
    // « 1234.560 » n'a qu'une lecture. « 2.800 », lui, en a deux.
    ["1234.560", [1_234_560]],
    ["2.800", [2_800, 2_800_000]],
    ["1234560", [1_234_560, 1_234_560_000]],
    ["1 234 560", [1_234_560, 1_234_560_000]],
  ];
  for (const [brut, attendus] of cas) {
    it(`« ${brut} »`, () => {
      assert.deepEqual(
        candidatsMontant(brut, 3)
          .map((c) => c.mineur)
          .sort((a, b) => a - b),
        attendus,
      );
    });
  }

  it("plus de décimales que la devise n'en porte, non nulles : aucune lecture", () => {
    assert.deepEqual(candidatsMontant("1234,5678", 3), []);
  });
});

describe("un droit fixe du paramétrage ancre l'échelle", () => {
  // « 100,000 / 19,000 / 1,000 / 120,000 » : lus tous en millimes ou tous en
  // dinars (virgule des milliers), la facture tient pareil — le timbre imprimé
  // est lui-même ambigu. Ce qui tranche, c'est ce qu'il DOIT valoir : le droit
  // de timbre est fixé par le paramétrage daté (1,000 DT).
  const facture = {
    bases: [{ ht: "100,000", taux: "0.19" }],
    tva: "19,000",
    ttc: "120,000",
  };

  it("sans ancre : ambigu, aucun chiffre", () => {
    const r = normaliserMontants({ ...facture, autres: ["1,000"] }, P);
    assert.equal(r.etat, "ambigu");
  });

  it("avec la valeur que le paramétrage fixe au timbre : tranché", () => {
    const r = normaliserMontants({ ...facture, autres: [{ brut: "1,000", attendu: 1_000 }] }, P);
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 100_000);
    assert.equal(r.montants.ttc, 120_000);
    assert.match(r.raison, /paramétrage/);
  });

  it("un droit imprimé qui ne vaut pas ce que fixe le paramétrage n'ancre rien", () => {
    const r = normaliserMontants({ ...facture, autres: [{ brut: "1,000", attendu: 2_000 }] }, P);
    assert.equal(r.etat, "ambigu");
  });
});
