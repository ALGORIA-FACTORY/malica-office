/**
 * La version des règles du jugement suit le jugement lui-même.
 *
 * Revue de la PR 143 : `REGLES_DU_JUGEMENT` dit si un jugement posé est
 * périmé. Une version qu'il faut penser à changer est une version qu'on
 * oublie — et l'oubli ne se voit pas : les jugements d'avant passent pour à
 * jour, et le cabinet relit « le Socle ne propose rien » là où les règles du
 * jour proposent.
 *
 * La version porte donc l'empreinte de ce que le jugement rend sur le témoin
 * de mesure. Si le jugement change, cette épreuve échoue et donne la valeur
 * à écrire.
 *
 *   node --experimental-strip-types --test src/scan/les-regles-du-jugement-suivent-le-jugement.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REGLES_DU_JUGEMENT } from "./analyse.ts";
import { empreinteDesJugements } from "./mesure-des-propositions.ts";

describe("la version des règles du jugement", () => {
  it("porte l'empreinte de ce que le jugement rend sur le témoin", () => {
    const empreinte = empreinteDesJugements().slice(0, 12);
    const [date, portee] = REGLES_DU_JUGEMENT.split(".");
    assert.match(date ?? "", /^\d{4}-\d{2}-\d{2}$/, "la version commence par une date");
    assert.equal(
      portee,
      empreinte,
      `le jugement a changé sur le témoin : écrivez REGLES_DU_JUGEMENT = "<date du jour>.${empreinte}" ` +
        "(apps/api/src/scan/analyse.ts) — les pièces jugées avant seront rejugées.",
    );
  });

  it("l'empreinte est stable d'un passage à l'autre", () => {
    assert.equal(empreinteDesJugements(), empreinteDesJugements());
  });
});
