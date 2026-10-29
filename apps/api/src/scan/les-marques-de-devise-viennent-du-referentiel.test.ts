/**
 * Les marques de devise que retirent les lecteurs de montants viennent du
 * référentiel, et la copie des épreuves dit la même chose que lui.
 *
 * 30 octobre 2026. « 1 234,560 D.T. » se lisait 1 234 560 dinars à la lecture
 * au plan de jetons, et la normalisation du scan portait sa propre liste de
 * marques en dur. Les marques vivent désormais dans `ref.devises` et
 * `ref.devises_marques` ; cette épreuve les lit sous l'identité d'un vrai
 * compte (la politique de lecture comprise) et les compare à
 * `MARQUES_D_ESSAI`, dont se servent les épreuves pures.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { creerCompte } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";

import { lireMarquesDeDevise } from "./analyse.ts";
import { MARQUES_D_ESSAI } from "./devise-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("les marques de devise du référentiel", { skip: !BASE_CONFIGUREE }, () => {
  after(() => fermerLePool());

  it("se lisent sous l'identité d'un compte, et valent la copie des épreuves", async () => {
    const u = await creerCompte(`marques-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    const marques = await sousIdentite(u.id, (db) => lireMarquesDeDevise(db));
    assert.deepEqual(
      [...marques].sort(),
      [...MARQUES_D_ESSAI].sort(),
      "ref.devises + ref.devises_marques et MARQUES_D_ESSAI divergent",
    );
  });
});
