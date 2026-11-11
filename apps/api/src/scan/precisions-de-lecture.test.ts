/**
 * Ce que la personne a corrigé prend la place de ce que la lecture a lu, pour
 * juger — et pour juger seulement : la fonction est pure, la lecture n'est pas
 * touchée (R7). Aucune valeur de devise n'est écrite ici : l'appelant la donne.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appliquerLesPrecisionsDeMontant,
  mettreLaValeur,
  valeurDuChemin,
} from "./precisions-de-lecture.ts";

const TND = { decimales: 3, separateur: "," };
const lecture = {
  lines: [{ base_ht: "15000.000" }],
  other_charges: [{ amount: "1.000" }],
  totals: { base_ht: "15000.000", vat: "2350.000", ttc: "17351.000" },
};
const imprime = (champ: string) =>
  ({ "totals.vat": "2 350,000", "totals.ttc": "17 351,000" })[champ] ?? null;

describe("les précisions de montant entrent dans le jugement", () => {
  it("la saisie prend la place du texte imprimé, à l'écriture de la devise", () => {
    const r = appliquerLesPrecisionsDeMontant(
      lecture,
      imprime,
      [
        { champ: "totals.vat", valeur: "2850.000" },
        { champ: "totals.ttc", valeur: "17851.000" },
      ],
      TND,
    );
    assert.equal(r.imprime("totals.vat"), "2850,000");
    assert.equal(r.imprime("totals.ttc"), "17851,000");
    assert.equal(r.payload.totals.vat, "2850.000");
    // Ce qui n'est pas précisé reste ce que la lecture a rendu.
    assert.equal(r.imprime("totals.base_ht"), null);
    assert.equal(r.payload.totals.base_ht, "15000.000");
  });

  it("la lecture d'origine n'est pas modifiée", () => {
    const avant = JSON.stringify(lecture);
    appliquerLesPrecisionsDeMontant(
      lecture,
      imprime,
      [{ champ: "totals.vat", valeur: "1.000" }],
      TND,
    );
    assert.equal(JSON.stringify(lecture), avant);
  });

  it("sans précision, rien ne change", () => {
    const r = appliquerLesPrecisionsDeMontant(lecture, imprime, [], TND);
    assert.equal(r.payload, lecture);
    assert.equal(r.imprime, imprime);
  });

  it("une facture à un seul taux : la base du pied corrigée est aussi celle de la ligne", () => {
    const r = appliquerLesPrecisionsDeMontant(
      lecture,
      imprime,
      [{ champ: "totals.base_ht", valeur: "14000.000" }],
      TND,
    );
    assert.equal(r.imprime("lines[0].base_ht"), "14000,000");
    assert.equal(r.payload.lines?.[0]?.base_ht, "14000.000");
  });

  it("à plusieurs taux, la base du pied ne remplace pas celle de chaque ligne", () => {
    const deux = { ...lecture, lines: [{ base_ht: "10000.000" }, { base_ht: "5000.000" }] };
    const r = appliquerLesPrecisionsDeMontant(
      deux,
      imprime,
      [{ champ: "totals.base_ht", valeur: "14000.000" }],
      TND,
    );
    assert.equal(r.imprime("lines[0].base_ht"), null);
    assert.equal(r.imprime("totals.base_ht"), "14000,000");
  });

  it("un droit se corrige ; l'index d'un droit que la lecture n'a pas relevé est ignoré", () => {
    const r = appliquerLesPrecisionsDeMontant(
      lecture,
      imprime,
      [
        { champ: "other_charges[0].amount", valeur: "2.000" },
        { champ: "other_charges[5].amount", valeur: "9.000" },
      ],
      TND,
    );
    assert.equal(r.imprime("other_charges[0].amount"), "2,000");
    assert.equal(r.imprime("other_charges[5].amount"), null);
    assert.equal(r.payload.other_charges?.length, 1);
  });

  it("une devise sans décimales s'écrit sans séparateur ; une saisie courte se complète", () => {
    const xof = appliquerLesPrecisionsDeMontant(
      lecture,
      imprime,
      [{ champ: "totals.vat", valeur: "2850" }],
      { decimales: 0, separateur: "," },
    );
    assert.equal(xof.imprime("totals.vat"), "2850");
    // « 2850 » sans décimales se lirait en dinars ou en millimes : la devise complète.
    const tnd = appliquerLesPrecisionsDeMontant(
      lecture,
      imprime,
      [{ champ: "totals.vat", valeur: "2850" }],
      TND,
    );
    assert.equal(tnd.imprime("totals.vat"), "2850,000");
  });
});

describe("un champ se lit et se pose par son chemin de citation", () => {
  it("lit la valeur lue à un chemin, ou rien", () => {
    assert.equal(valeurDuChemin(lecture, "totals.vat"), "2350.000");
    assert.equal(valeurDuChemin(lecture, "other_charges[0].amount"), "1.000");
    assert.equal(valeurDuChemin(lecture, "other_charges[3].amount"), null);
    assert.equal(valeurDuChemin(null, "totals.vat"), null);
  });

  it("pose la valeur sur une copie, et ne crée pas un champ que la lecture n'a pas", () => {
    const copie = { ...lecture };
    mettreLaValeur(copie, "other_charges[0].amount", "5.000");
    assert.equal(copie.other_charges[0]?.amount, "5.000");
    assert.equal(lecture.other_charges[0]?.amount, "1.000", "l'original reste intact");
    mettreLaValeur(copie as Record<string, unknown>, "totals.inconnu", "1");
    assert.equal((copie.totals as Record<string, unknown>)["inconnu"], undefined);
  });
});
