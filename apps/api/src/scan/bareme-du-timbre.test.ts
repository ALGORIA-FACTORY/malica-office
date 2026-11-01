/**
 * Le droit attendu au barème daté, sans base : le barème du pack relevé
 * (`referentiel-d-essai.json`), ses bornes, et la réserve quand la catégorie de
 * l'émetteur manque. L'effet en base : `le-timbre-suit-le-bareme-date.test.ts`.
 *
 *   node --experimental-strip-types --test src/scan/bareme-du-timbre.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { droitsAuBareme, optionDuTimbre, type TimbreDeLaPiece } from "./bareme-du-timbre.ts";
import { BAREME_DES_DROITS_D_ESSAI, DROITS_D_ESSAI } from "./referentiel-d-essai.ts";

const SENS = "facture_achat";
const regle = DROITS_D_ESSAI.find((d) => d.documentKind === SENS && d.code === "DROIT_TIMBRE")!;
const STANDARD = regle.fixedAmount!;
const AUTRE = BAREME_DES_DROITS_D_ESSAI.tranches[0]!.categorie;
const tranches = BAREME_DES_DROITS_D_ESSAI.tranches.filter((t) => t.droit === regle.code);
const premiere = tranches.find((t) => t.a !== null)!;
const derniere = tranches.find((t) => t.a === null)!;

/** Le montant fixe attendu du timbre, et les réserves, pour un TTC et un droit imprimé. */
function attendu(ttc: string, imprime: string, categorie: string | null) {
  const timbre: TimbreDeLaPiece = { bareme: BAREME_DES_DROITS_D_ESSAI, categorie };
  const r = droitsAuBareme({
    droits: DROITS_D_ESSAI,
    imprimes: [{ code: regle.code, amount: imprime }],
    sens: SENS,
    ttc,
    timbre,
  });
  const fixe = r.droits.find((d) => d.code === regle.code && d.documentKind === SENS)!;
  return { montant: fixe.fixedAmount, reserves: r.reserves };
}

describe("le barème daté du timbre", () => {
  it("le pack porte le droit standard et deux tranches d'une autre catégorie", () => {
    assert.ok(premiere && derniere && AUTRE !== BAREME_DES_DROITS_D_ESSAI.standard);
    assert.notEqual(premiere.montant, STANDARD);
  });

  it("classé dans l'autre catégorie : la tranche qui couvre le TTC, bornes comprises", () => {
    assert.equal(attendu(premiere.de, STANDARD, AUTRE).montant, premiere.montant);
    // La borne commune revient à la première tranche (« de 50 à 100 »).
    assert.equal(attendu(premiere.a!, STANDARD, AUTRE).montant, premiere.montant);
    assert.equal(attendu(`${premiere.a!}1`, STANDARD, AUTRE).montant, derniere.montant);
    // Sous la première tranche : le droit standard (INCERTAIN, nommé dans la migration).
    assert.equal(attendu("1.000", STANDARD, AUTRE).montant, STANDARD);
  });

  it("classé standard : le droit standard, quel que soit le TTC", () => {
    const standard = BAREME_DES_DROITS_D_ESSAI.standard;
    assert.deepEqual(attendu(premiere.de, derniere.montant, standard), {
      montant: STANDARD,
      reserves: [],
    });
  });

  it("non classé : le droit standard sans réserve ; le tarif de l'autre catégorie avec", () => {
    assert.deepEqual(attendu(premiere.de, STANDARD, null), { montant: STANDARD, reserves: [] });
    assert.deepEqual(attendu(premiere.de, premiere.montant, null), {
      montant: premiere.montant,
      reserves: [
        {
          code: "categorie_d_emetteur",
          droit: regle.code,
          categorie: AUTRE,
          montant: premiere.montant,
        },
      ],
    });
    // Le tarif d'une AUTRE tranche que celle du TTC n'est le tarif de personne.
    assert.deepEqual(attendu(premiere.de, derniere.montant, null), {
      montant: STANDARD,
      reserves: [],
    });
  });

  it("l'autre sens et les droits sans barème ne changent pas", () => {
    const r = droitsAuBareme({
      droits: DROITS_D_ESSAI,
      imprimes: [{ code: regle.code, amount: premiere.montant }],
      sens: SENS,
      ttc: premiere.de,
      timbre: { bareme: BAREME_DES_DROITS_D_ESSAI, categorie: AUTRE },
    });
    r.droits.forEach((d, i) => {
      if (d.documentKind !== SENS || d.code !== regle.code) assert.equal(d, DROITS_D_ESSAI[i]);
    });
    assert.ok(DROITS_D_ESSAI.some((d) => d.documentKind !== SENS || d.code !== regle.code));
  });

  it("l'option se lit, et une valeur inconnue est une erreur nommée", () => {
    assert.equal(optionDuTimbre(new Map()), null);
    assert.equal(optionDuTimbre(new Map([["timbre.bareme", "fixe_1d"]])), "fixe_1d");
    assert.throws(
      () => optionDuTimbre(new Map([["timbre.bareme", "au_hasard"]])),
      /reglage\.timbre\.illisible/,
    );
  });
});
