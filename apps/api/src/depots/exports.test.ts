/**
 * La mise en forme des exports, prouvée sans base ni réseau.
 *
 * Ce qui se casse en silence : une colonne de plus ou de moins dans le FEC,
 * une date qui garde ses tirets, une barre dans un libellé qui décale toute
 * la ligne. Rien de tout cela n'est un chiffre : les montants et comptes
 * d'essai sont des valeurs de forme, pas des données comptables.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COLONNES_CSV_ECRITURES,
  COLONNES_FEC,
  dateFec,
  empreinte,
  formaterCsvEcritures,
  formaterFec,
  tailleEnOctets,
  type LigneExport,
} from "./exports.ts";

const DEVISE_DU_PACK = "XXX";

function ligne(partiel: Partial<LigneExport> = {}): LigneExport {
  return {
    clientTenantId: "00000000-0000-4000-8000-000000000001",
    clientNom: "Dossier d'essai",
    clientLegalId: null,
    ecritureId: "00000000-0000-4000-8000-000000000002",
    numero: 1,
    journal: "J",
    journalLibelle: "Journal d'essai",
    dateEcriture: "2026-03-05",
    ordinal: 1,
    compte: "A",
    compteLibelle: "Compte A",
    pieceRef: "piece-1",
    pieceDate: "2026-03-01",
    ecritureLibelle: "Écriture d'essai",
    ligneLibelle: "Ligne d'essai",
    debit: "10.5",
    credit: "0",
    taxCode: null,
    valideLe: "2026-03-06",
    devise: DEVISE_DU_PACK,
    ...partiel,
  };
}

describe("le FEC", () => {
  it("aligne dix-huit colonnes, en-tête compris", () => {
    const texte = formaterFec([ligne()], 3, DEVISE_DU_PACK);
    const lignes = texte.trimEnd().split("\r\n");
    assert.equal(lignes.length, 2);
    assert.equal(COLONNES_FEC.length, 18);
    for (const l of lignes) assert.equal(l.split("|").length, 18, l);
    assert.equal(lignes[0], COLONNES_FEC.join("|"));
  });

  it("écrit les dates en AAAAMMJJ et les montants à la précision demandée", () => {
    assert.equal(dateFec("2026-03-05"), "20260305");
    const champs = formaterFec([ligne()], 3, DEVISE_DU_PACK).split("\r\n")[1]!.split("|");
    assert.equal(champs[3], "20260305");
    assert.equal(champs[9], "20260301");
    assert.equal(champs[15], "20260306");
    assert.equal(champs[11], "10.500");
    assert.equal(champs[12], "0.000");
    // La précision vient du pack : deux décimales donnent deux décimales.
    const deux = formaterFec([ligne()], 2, DEVISE_DU_PACK).split("\r\n")[1]!.split("|");
    assert.equal(deux[11], "10.50");
  });

  it("laisse la devise vide quand l'écriture est tenue dans celle du pack", () => {
    const champs = formaterFec([ligne()], 3, DEVISE_DU_PACK).split("\r\n")[1]!.split("|");
    assert.equal(champs[16], "");
    assert.equal(champs[17], "");
    const autre = formaterFec([ligne({ devise: "YYY" })], 3, DEVISE_DU_PACK)
      .split("\r\n")[1]!
      .split("|");
    assert.equal(autre[16], "10.500");
    assert.equal(autre[17], "YYY");
  });

  it("ne laisse jamais une barre dans un champ décaler la ligne", () => {
    const champs = formaterFec([ligne({ ecritureLibelle: "a | b\nc" })], 3, DEVISE_DU_PACK)
      .split("\r\n")[1]!
      .split("|");
    assert.equal(champs.length, 18);
    assert.equal(champs[10], "a b c");
  });

  it("nomme l'écriture dans EcritureLib, et ne retombe sur la ligne qu'à défaut", () => {
    const nommee = formaterFec([ligne()], 3, DEVISE_DU_PACK).split("\r\n")[1]!.split("|");
    assert.equal(nommee[10], "Écriture d'essai");
    const sansNom = formaterFec([ligne({ ecritureLibelle: "" })], 3, DEVISE_DU_PACK)
      .split("\r\n")[1]!
      .split("|");
    assert.equal(sansNom[10], "Ligne d'essai");
  });
});

describe("le CSV des écritures", () => {
  it("commence par la marque d'ordre d'octets et protège les séparateurs", () => {
    const texte = formaterCsvEcritures([ligne({ ecritureLibelle: 'a;b "c"' })], 3);
    assert.ok(texte.startsWith("\uFEFF"));
    const lignes = texte.trimEnd().split("\r\n");
    assert.equal(lignes[0], "\uFEFF" + COLONNES_CSV_ECRITURES.join(";"));
    assert.ok(lignes[1]!.includes('"a;b ""c"""'));
  });
});

describe("la mesure", () => {
  it("compte les octets, pas les caractères, et empreint en SHA-256", () => {
    assert.equal(tailleEnOctets("é"), 2);
    assert.match(empreinte("x"), /^[0-9a-f]{64}$/);
    assert.notEqual(empreinte("x"), empreinte("y"));
  });
});
