/**
 * La mesure des propositions, et ce qu'elle interdit : qu'une pièce qui
 * recevait une écriture exacte en reçoive une fausse, ou plus aucune.
 *
 * `mesure-des-propositions.avant.json` est l'issue de chaque pièce le
 * 30 octobre 2026, AVANT les déductions arithmétiques (TVA, taux, droit fixé,
 * base d'une ligne). Il ne se régénère pas pour faire passer l'épreuve : une
 * pièce qui sort de « exacte » est une régression, quelle qu'en soit la cause.
 *
 *   node --experimental-strip-types --test src/scan/mesure-des-propositions.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CAS_DE_MESURE, mesurer, rapport, type Issue } from "./mesure-des-propositions.ts";

const AVANT = JSON.parse(
  readFileSync(new URL("./mesure-des-propositions.avant.json", import.meta.url), "utf8"),
) as Record<string, Issue>;

describe("la mesure des propositions", () => {
  const m = mesurer();

  it("imprime son rapport", (t) => {
    t.diagnostic(`\n${rapport(m)}`);
    assert.equal(m.total, CAS_DE_MESURE.length);
  });

  it("aucune pièce exacte avant ne devient fausse ou sans proposition", () => {
    const perdues = Object.entries(AVANT)
      .filter(([, i]) => i.type === "exacte")
      .filter(([nom]) => m.parCas[nom]?.type !== "exacte")
      .map(([nom]) => `${nom} : ${JSON.stringify(m.parCas[nom])}`);
    assert.deepEqual(perdues, []);
  });

  it("aucun refus juste avant ne devient une proposition", () => {
    const forcees = Object.entries(AVANT)
      .filter(([, i]) => i.type === "refus_juste")
      .filter(([nom]) => m.parCas[nom]?.type !== "refus_juste")
      .map(([nom]) => `${nom} : ${JSON.stringify(m.parCas[nom])}`);
    assert.deepEqual(forcees, []);
  });

  it("aucune écriture fausse : proposer moins vaut mieux que proposer faux", () => {
    const fausses = Object.entries(m.parCas)
      .filter(([, i]) => i.type === "fausse")
      .map(([nom, i]) => `${nom} : ${"cause" in i ? i.cause : ""}`);
    assert.deepEqual(fausses, []);
  });

  it("les causes levées le 30 octobre reçoivent une écriture exacte", () => {
    // Chacune était « aucune » au témoin : ce sont les déductions que
    // l'arithmétique prouve, la date émise d'avance, le montant peu sûr fermé.
    const levees = [
      "TVA illisible, deux taux : HT et TTC la prouvent",
      "TVA illisible, un taux : HT et TTC la prouvent",
      "aucune ligne par taux lue : le taux se retrouve",
      "code de taux inconnu du paramétrage : le taux se retrouve",
      "deux taux, une base illisible : le HT du pied la prouve",
      "un total peu sûr que l'arithmétique vérifie",
      "datée après sa réception, dans la même période de TVA",
      "le timbre nommé, son montant non cité",
      "le timbre cité, illisible",
    ];
    assert.deepEqual(
      levees.filter((nom) => m.parCas[nom]?.type !== "exacte"),
      [],
    );
  });

  it("chaque pièce du témoin est encore mesurée", () => {
    assert.deepEqual(
      Object.keys(AVANT).filter((nom) => !(nom in m.parCas)),
      [],
    );
  });
});
