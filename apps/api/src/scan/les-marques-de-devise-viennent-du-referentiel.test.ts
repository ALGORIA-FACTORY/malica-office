/**
 * Les devises que lisent les lecteurs de montants viennent du référentiel, et
 * la copie des épreuves dit la même chose que le chargeur de production.
 *
 * 30 octobre 2026. « 1 234,560 D.T. » se lisait 1 234 560 dinars à la lecture
 * au plan de jetons, et la normalisation du scan portait sa propre liste de
 * marques en dur. Les marques vivent désormais dans `ref.devises` et
 * `ref.devises_marques`, chacune avec SA devise (revue de la PR 144 :
 * « 100,00 € » ne se lit pas en dinars). Cette épreuve lit les devises par le
 * chargeur de production (`lireLesDevises`), sous l'identité d'un vrai compte
 * (la politique de lecture comprise), et les compare à `DEVISES_LUES_D_ESSAI`,
 * dont se servent les épreuves pures — relevé, lui, par une autre requête
 * (`releve-du-referentiel.ts`).
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { creerCompte } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";

import { lireLesDevises } from "./analyse.ts";
import { DEVISES_LUES_D_ESSAI } from "./devise-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("les devises du référentiel", { skip: !BASE_CONFIGUREE }, () => {
  after(() => fermerLePool());

  it("se lisent sous l'identité d'un compte, et valent la copie des épreuves", async () => {
    const u = await creerCompte(`marques-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    const devises = await sousIdentite(u.id, (db) => lireLesDevises(db));
    assert.deepEqual(devises, DEVISES_LUES_D_ESSAI);
  });

  it("chaque marque imprimée nomme sa devise : le franc CFA a les siennes", async () => {
    const u = await creerCompte(`cfa-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    const [devise] = await sousIdentite(u.id, (db) => lireLesDevises(db));
    const de = (marque: string) => devise!.marques.find((m) => m.marque === marque)?.devise;
    assert.equal(de("€"), "EUR");
    assert.equal(de("D.T."), "TND");
    assert.equal(de("F CFA"), "XOF");
    assert.equal(de("FCFA"), "XOF");
  });
});
