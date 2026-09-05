import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creerRegistre } from "./lectures-en-cours.ts";

function differee<T>() {
  let resoudre!: (v: T) => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<T>((res, rej) => {
    resoudre = res;
    rejeter = rej;
  });
  return { promesse, resoudre, rejeter };
}

describe("le registre des lectures en cours", () => {
  it("rend la lecture déjà en cours au lieu d'en lancer une seconde", async () => {
    const r = creerRegistre<string>(() => 1000);
    const d = differee<string>();
    let lancements = 0;
    const lancer = () => {
      lancements += 1;
      return d.promesse;
    };

    const premiere = r.lireOuRejoindre("p1", lancer);
    // Le téléphone a réessayé : même pièce, même lecture, pas de second appel.
    const seconde = r.lireOuRejoindre("p1", lancer);
    assert.equal(lancements, 1);
    assert.deepEqual(r.etat("p1"), { depuis: 1000 });
    assert.equal(r.enCours(), 1);

    d.resoudre("lue");
    assert.equal(await premiere, "lue");
    assert.equal(await seconde, "lue");
    assert.equal(r.etat("p1"), null);
    assert.equal(r.enCours(), 0);
  });

  it("oublie une lecture qui échoue, pour qu'on puisse réessayer", async () => {
    const r = creerRegistre<string>();
    const d = differee<string>();
    const p = r.lireOuRejoindre("p2", () => d.promesse);
    d.rejeter(new Error("lecture.vide"));
    await assert.rejects(p, new RegExp("lecture\\.vide"));
    assert.equal(r.etat("p2"), null);

    // Un nouvel essai part bel et bien.
    let relance = 0;
    await r.lireOuRejoindre("p2", async () => {
      relance += 1;
      return "ok";
    });
    assert.equal(relance, 1);
  });

  it("tient chaque pièce à part", () => {
    const r = creerRegistre<string>();
    const a = differee<string>();
    const b = differee<string>();
    void r.lireOuRejoindre("a", () => a.promesse);
    void r.lireOuRejoindre("b", () => b.promesse);
    assert.equal(r.enCours(), 2);
    assert.notEqual(r.etat("a"), null);
    assert.equal(r.etat("c"), null);
    a.resoudre("");
    b.resoudre("");
  });
});
