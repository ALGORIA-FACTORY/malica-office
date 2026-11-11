/**
 * Les chemins de lecture du conseil cité : le numéro que la personne écrit,
 * et l'ordre dans lequel les textes sont remis au modèle.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dansLOrdreDeLecture } from "./conseil-cite.ts";
import { numerosEcrits } from "./corpus.ts";

describe("le numéro que la personne écrit", () => {
  it("retient « article 52 », « art. 51 ter », plusieurs fois", () => {
    assert.deepEqual(numerosEcrits("Que dit l'article 52 du code ?"), ["52"]);
    assert.deepEqual(numerosEcrits("art. 51 ter et Article 49, puis l'article 52"), [
      "51 ter",
      "49",
      "52",
    ]);
  });

  it("ne prend pas un montant ou une année pour un article", () => {
    assert.deepEqual(numerosEcrits("Une facture de 3 000 dinars en 2026"), []);
    assert.deepEqual(numerosEcrits("Quel est le taux de la TVA ?"), []);
  });
});

describe("l'ordre de lecture", () => {
  it("le code avant la loi de finances avant la note commune, le classement tenu à ordre égal", () => {
    const lus = dansLOrdreDeLecture([
      { id: "note-1", ordreDeLecture: 6 },
      { id: "lf", ordreDeLecture: 3 },
      { id: "code-a", ordreDeLecture: 1 },
      { id: "note-2", ordreDeLecture: 6 },
      { id: "code-b", ordreDeLecture: 1 },
    ]);
    assert.deepEqual(
      lus.map((p) => p.id),
      ["code-a", "code-b", "lf", "note-1", "note-2"],
    );
  });

  it("un texte sans ordre en base se lit en dernier", () => {
    const lus = dansLOrdreDeLecture([
      { id: "inconnu", ordreDeLecture: null },
      { id: "ancien" },
      { id: "code", ordreDeLecture: 1 },
    ]);
    assert.deepEqual(
      lus.map((p) => p.id),
      ["code", "inconnu", "ancien"],
    );
  });
});
