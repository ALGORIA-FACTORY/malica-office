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
import { deviseDEssai } from "./devise-d-essai.ts";

/** Ce qui vient du paramétrage dans la vraie vie — ici, fixé par le test. */
const P = { ...deviseDEssai(3), toleranceMineure: 1 };
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
    // Avec un timbre « 1,000 » — un dinar : la virgule est le séparateur
    // décimal du dinar —, une seule combinaison tient, la lecture en millimes :
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
    const c = candidatsMontant("2.800", P);
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

  /*
   * ====================== UNE PLAGE QUI A COUVERT LE MÊME MONTANT DEUX FOIS
   *
   * 10 octobre 2026. La facture PAPETERIE NOUR reste bloquée, et l'écran dit :
   * « montant illisible : « 514,700 514,700 » ».
   *
   * C'est l'envers de la plage de jetons ouverte le 5 octobre pour recoller
   * « 2 800,000 », coupé par l'espace des milliers. Une plage peut désormais
   * couvrir DEUX montants — ici le même, imprimé deux fois côte à côte, comme
   * le font les factures qui répètent le total en pied de colonne.
   *
   * Deux virgules décimales : aucune lecture ne tient, et la chaîne a eu
   * raison de ne rien rendre plutôt que d'inventer. Le garde a fonctionné.
   *
   * Mais il existe un cas où ne rien rendre est excessif : quand les blocs
   * répétés sont IDENTIQUES. « 514,700 514,700 » n'a qu'une valeur possible,
   * quelle que soit la façon dont on décide où la plage aurait dû s'arrêter.
   * La rendre n'est pas une supposition — c'est la seule lecture cohérente.
   *
   * La limite est stricte, et les deux épreuves suivantes la tiennent : des
   * blocs DIFFÉRENTS restent illisibles, parce que là on ne sait pas lequel
   * est le bon ; et « 2 800,000 » ne se coupe pas en « 2 » et « 800,000 »,
   * parce que ses blocs ne sont pas identiques.
   */
  it("le même montant répété n'a qu'une valeur, et elle se lit", () => {
    assert.deepEqual(
      candidatsMontant("514,700 514,700", deviseDEssai(3)).map((c) => c.mineur),
      candidatsMontant("514,700", deviseDEssai(3)).map((c) => c.mineur),
      "une plage qui a couvert deux fois le même montant lit ce montant",
    );
    // La facture PAPETERIE NOUR telle qu'elle est imprimée. La virgule est le
    // séparateur décimal du dinar : 514,700 ne se lit qu'en dinars (avant le
    // 30 octobre 2026, la normalisation le lisait aussi à l'anglaise, et seul
    // le droit de timbre fixé tranchait l'échelle).
    const r = normaliserMontants(
      {
        bases: [{ ht: "514,700 514,700", taux: "0.19" }],
        tva: "97,793",
        autres: [{ brut: "1,000", attendu: 1000 }],
        ttc: "613,493",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 514_700, "en millimes");
    assert.equal(r.montants.ttc, 613_493);
  });

  it("deux montants DIFFÉRENTS restent illisibles : on ne choisit pas", () => {
    assert.deepEqual(candidatsMontant("514,700 200,000", deviseDEssai(3)), []);
    assert.deepEqual(candidatsMontant("1 000,000 2 000,000", deviseDEssai(3)), []);
  });

  it("et un montant coupé par l'espace des milliers se recolle toujours", () => {
    // La garantie du 5 octobre. Si la règle de répétition la cassait, la
    // troncature des milliers reviendrait — et c'était le défaut n° 1.
    assert.deepEqual(
      candidatsMontant("2 800,000", deviseDEssai(3)).map((c) => c.mineur),
      candidatsMontant("2800,000", deviseDEssai(3)).map((c) => c.mineur),
    );
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
    assert.equal(
      normaliserMontants(entree, { ...deviseDEssai(3), toleranceMineure: 1 }).etat,
      "tranche",
    );
    assert.equal(
      normaliserMontants(entree, { ...deviseDEssai(3), toleranceMineure: 0 }).etat,
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
        candidatsMontant(brut, deviseDEssai(3))
          .map((c) => c.mineur)
          .sort((a, b) => a - b),
        attendus,
      );
    });
  }

  it("plus de décimales que la devise n'en porte, non nulles : aucune lecture", () => {
    assert.deepEqual(candidatsMontant("1234,5678", deviseDEssai(3)), []);
  });
});

describe("un droit fixe du paramétrage ancre l'échelle", () => {
  // « 100.000 / 19.000 / 1.000 / 120.000 » : lus tous en millimes ou tous en
  // dinars (point des milliers), la facture tient pareil — le timbre imprimé
  // est lui-même ambigu. Ce qui tranche, c'est ce qu'il DOIT valoir : le droit
  // de timbre est fixé par le paramétrage daté (1,000 DT).
  const facture = {
    bases: [{ ht: "100.000", taux: "0.19" }],
    tva: "19.000",
    ttc: "120.000",
  };

  it("sans ancre : ambigu, aucun chiffre", () => {
    const r = normaliserMontants({ ...facture, autres: ["1.000"] }, P);
    assert.equal(r.etat, "ambigu");
  });

  it("avec la valeur que le paramétrage fixe au timbre : tranché", () => {
    const r = normaliserMontants({ ...facture, autres: [{ brut: "1.000", attendu: 1_000 }] }, P);
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 100_000);
    assert.equal(r.montants.ttc, 120_000);
    assert.match(r.raison, /paramétrage/);
  });

  it("un droit imprimé qui ne vaut pas ce que fixe le paramétrage n'ancre rien", () => {
    const r = normaliserMontants({ ...facture, autres: [{ brut: "1.000", attendu: 2_000 }] }, P);
    assert.equal(r.etat, "ambigu");
  });

  it("à la virgule, la convention du dinar décide — et le dit : réserve, jamais la confiance pleine", () => {
    // Avant le 30 octobre 2026, la normalisation lisait aussi « 100,000 » à
    // l'anglaise (100 000 dinars) : sans ancre, ambigu. La virgule est le
    // séparateur décimal du dinar, donc 100 dinars. Mais lus à l'anglaise, les
    // mêmes montants tiennent aussi : la valeur n'est décidée que par la
    // convention (revue de la PR 144), et la normalisation le dit.
    const r = normaliserMontants(
      {
        bases: [{ ht: "100,000", taux: "0.19" }],
        tva: "19,000",
        autres: ["1,000"],
        ttc: "120,000",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 100_000);
    assert.equal(r.parConvention, true);
    assert.ok(r.confiance < 1, "décidé par la convention, pas par la pièce");
    assert.match(r.raison, /convention/);
  });

  it("à la virgule, avec le timbre que fixe le paramétrage : la pièce décide, pas la convention", () => {
    // Lus à l'anglaise, le timbre fixé (1,000 DT) ne tombe plus juste : seule
    // la lecture décimale tient, et la convention n'a rien décidé.
    const r = normaliserMontants(
      {
        bases: [{ ht: "100,000", taux: "0.19" }],
        tva: "19,000",
        autres: [{ brut: "1,000", attendu: 1_000 }],
        ttc: "120,000",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.parConvention, false);
    assert.equal(r.confiance, 1);
  });

  it("un droit fixé imprimé à une autre valeur n'ancre rien : la convention se dit encore", () => {
    // Revue de la PR 144 (Codex) : le droit attendu à 1,000 s'imprime 2,000.
    // Il ne tombe pas sur sa valeur fixée, donc n'ancre pas l'échelle ; lus
    // à l'anglaise (× 1000), tous les montants vérifient aussi la facture.
    // La seule PRÉSENCE d'une valeur attendue ne doit pas taire la convention.
    const r = normaliserMontants(
      {
        bases: [{ ht: "100,000", taux: "0.19" }],
        tva: "19,000",
        autres: [{ brut: "2,000", attendu: 1_000 }],
        ttc: "121,000",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.autres[0], 2_000);
    assert.equal(r.parConvention, true);
    assert.ok(r.confiance < 1, "décidé par la convention, pas par la pièce");
    assert.match(r.raison, /convention du séparateur/);
  });

  it("le HT qui comprend un droit non fixé ne contourne pas la convention", () => {
    // Revue de la PR 144 (Codex) : la branche « HT autres compris » rendait
    // sa lecture avant le contrôle de la convention. 101,000 − 1,000 = 100,000
    // de base, 19,000 de TVA, 120,000 de total — et × 1000, tout tient aussi.
    const r = normaliserMontants(
      {
        bases: [{ ht: "101,000", taux: "0.19" }],
        tva: "19,000",
        autres: ["1,000"],
        ttc: "120,000",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 100_000);
    assert.equal(r.parConvention, true);
    assert.ok(r.confiance < 1);
    assert.match(r.raison, /convention du séparateur/);
  });
});

/*
 * 26 octobre 2026 — facture MYTEK réelle : « TOTAL HT 428,731 » comprend le
 * timbre ; « Base TVA 427,731 », « TVA 81,269 », « Timbre fiscal 1,000 »,
 * « TTC 510,000 ». Lu tel quel, le timbre comptait deux fois et la pièce
 * finissait « incohérente », sans aucun montant.
 */
describe("le HT imprimé qui comprend déjà le timbre", () => {
  const TIMBRE = [{ brut: "1,000", attendu: 1000 }];

  it("la base taxable se déduit, et la TVA comme le total la vérifient", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "428,731", taux: TAUX }],
        tva: "81,269",
        autres: TIMBRE,
        ttc: "510,000",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]?.ht, 427_731, "la base taxable, pas le HT imprimé");
    assert.equal(r.montants.tva, 81_269);
    assert.deepEqual(r.montants.autres, [1000]);
    assert.equal(r.montants.ttc, 510_000);
    assert.equal(r.imprime.bases[0], "428,731", "ce que la pièce imprime reste dit");
    assert.match(r.raison, /comprend les autres montants/);
  });

  it("un HT sans timbre se lit comme avant : la seconde lecture ne sert pas", () => {
    const r = normaliserMontants(
      { bases: [{ ht: "427,731", taux: TAUX }], tva: "81,269", autres: TIMBRE, ttc: "510,000" },
      P,
    );
    assert.equal(r.etat, "tranche");
    assert.equal(r.montants.bases[0]?.ht, 427_731);
    assert.doesNotMatch(r.raison, /comprend/);
  });

  it("MYTEK tel qu'imprimé : « 510,000 DNT » se lit, « DNT » étant une marque du référentiel", () => {
    // La devise se lit dans le référentiel (R4), pas dans ce code : depuis le
    // 30 octobre 2026, `ref.devises_marques` porte « DNT » (dinar tunisien),
    // et le total imprimé confirme la base déduite avec la TVA.
    const r = normaliserMontants(
      {
        bases: [{ ht: "428,731", taux: TAUX }],
        tva: "81,269",
        autres: TIMBRE,
        ttc: "510,000 DNT",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]?.ht, 427_731);
    assert.equal(r.montants.ttc, 510_000);
    assert.equal(r.totalNonLu, null);
  });

  it("une marque que le référentiel ne connaît pas laisse le total non lu, la TVA suffit", () => {
    // Un total que la vérification ne lit pas est écarté et NOMMÉ, et la TVA
    // imprimée confirme seule la base déduite. « XTS » : le code ISO 4217
    // réservé aux essais, qu'aucun référentiel ne porte (« USD » y est entré
    // le 31 octobre 2026).
    const r = normaliserMontants(
      {
        bases: [{ ht: "428,731", taux: TAUX }],
        tva: "81,269",
        autres: TIMBRE,
        ttc: "510,000 XTS",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]?.ht, 427_731);
    assert.equal(r.totalNonLu, "510,000 XTS");
  });

  it("total non lu : la TVA seule vérifie la base déduite, sans la note pleine", () => {
    const r = normaliserMontants(
      { bases: [{ ht: "428,731", taux: TAUX }], tva: "81,269", autres: TIMBRE },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]?.ht, 427_731);
    assert.ok(r.confiance < 0.9);
  });

  it("sans TVA imprimée, on ne déduit rien : une seule confirmation ne suffit pas", () => {
    const r = normaliserMontants(
      { bases: [{ ht: "428,731", taux: TAUX }], autres: TIMBRE, ttc: "510,000" },
      P,
    );
    assert.notEqual(r.montants.bases[0]?.ht, 427_731);
  });

  it("une TVA qui ne tombe pas sur la base déduite reste incohérente", () => {
    const r = normaliserMontants(
      { bases: [{ ht: "428,731", taux: TAUX }], tva: "81,500", autres: TIMBRE, ttc: "510,231" },
      P,
    );
    assert.equal(r.etat, "incoherent");
  });
});
