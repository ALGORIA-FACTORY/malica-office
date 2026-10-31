/**
 * Le contrôle du cours de change, sur la vraie chaîne du jugement
 * (31 octobre 2026) : une pièce dans la devise du dossier n'en porte aucun ;
 * une pièce en devise porte la RÉSERVE « taux de change {date} {source} » si
 * un cours s'applique, sinon « taux {devise}/{dossier} du {jour} à saisir »,
 * sans aggraver le verdict (la PME n'a rien à corriger).
 *
 *   node --experimental-strip-types --test src/scan/le-cours-de-change.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { jourDuCours, type RegleDeChange } from "./cours-de-change.ts";
import { CAS_DE_MESURE, juger } from "./mesure-des-propositions.ts";

const cas = (nom: string) => {
  const c = CAS_DE_MESURE.find((x) => x.nom === nom);
  assert.ok(c, nom);
  return c;
};
const controleDuCours = (nom: string) =>
  juger(cas(nom)).controles.find((c) => c.code === "cours_de_change");

describe("le contrôle du cours de change", () => {
  it("une pièce dans la devise du dossier n'en porte aucun : son jugement ne change pas", () => {
    assert.equal(controleDuCours("achat simple, un taux et le timbre"), undefined);
  });

  it("un cours applicable : réserve « taux de change {date} {source} », le cours en preuve", () => {
    const nom =
      "facture en euros, cours du jour : convertie au millime, réserve « taux de change »";
    const c = controleDuCours(nom);
    assert.equal(c?.statut, "reserve");
    assert.equal(c?.motif, "taux de change 2026-09-10 BCT");
    assert.equal((c?.preuves["cours"] as { taux: string }).taux, "3.3456");
    assert.equal(juger(cas(nom)).verdict, "à comptabiliser avec réserve");
  });

  it("aucun cours : « à saisir », sans aggraver le verdict", () => {
    const nom = "facture en euros pour un dossier en dinars";
    const c = controleDuCours(nom);
    assert.equal(c?.statut, "non_evaluable");
    assert.equal(c?.motif, "taux EUR/TND du 2026-09-10 à saisir");
    assert.deepEqual(
      [c?.preuves["devise"], c?.preuves["versDevise"], c?.preuves["jour"], c?.preuves["source"]],
      ["EUR", "TND", "2026-09-10", "BCT"],
    );
    assert.equal(juger(cas(nom)).verdict, "à comptabiliser");
  });
});

describe("le jour dont le cours se lit", () => {
  const regle = (dateRetenue: RegleDeChange["dateRetenue"]): RegleDeChange => ({
    source: "SOURCE",
    dateRetenue,
    recul: 5,
    ecart: "base_la_plus_grande",
  });

  it("la date de la facture, ou celle de sa réception, selon la règle du pack", () => {
    assert.equal(jourDuCours(regle("date_facture"), "2026-09-10", "2026-09-15"), "2026-09-10");
    assert.equal(jourDuCours(regle("date_reception"), "2026-09-10", "2026-09-15"), "2026-09-15");
  });

  it("sans date de facture, la règle « date_facture » ne devine pas : aucun jour", () => {
    assert.equal(jourDuCours(regle("date_facture"), null, "2026-09-15"), null);
  });
});
