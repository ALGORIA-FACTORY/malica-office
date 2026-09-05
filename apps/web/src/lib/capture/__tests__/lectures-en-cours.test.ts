import { describe, expect, it } from "vitest";

import { creerRegistre } from "../lectures-en-cours.server";

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
    expect(lancements).toBe(1);
    expect(r.etat("p1")).toEqual({ depuis: 1000 });
    expect(r.enCours()).toBe(1);

    d.resoudre("lue");
    expect(await premiere).toBe("lue");
    expect(await seconde).toBe("lue");
    expect(r.etat("p1")).toBeNull();
    expect(r.enCours()).toBe(0);
  });

  it("oublie une lecture qui échoue, pour qu'on puisse réessayer", async () => {
    const r = creerRegistre<string>();
    const d = differee<string>();
    const p = r.lireOuRejoindre("p2", () => d.promesse);
    d.rejeter(new Error("lecture.vide"));
    await expect(p).rejects.toThrow("lecture.vide");
    expect(r.etat("p2")).toBeNull();

    // Un nouvel essai part bel et bien.
    let relance = 0;
    await r.lireOuRejoindre("p2", async () => {
      relance += 1;
      return "ok";
    });
    expect(relance).toBe(1);
  });

  it("tient chaque pièce à part", () => {
    const r = creerRegistre<string>();
    const a = differee<string>();
    const b = differee<string>();
    void r.lireOuRejoindre("a", () => a.promesse);
    void r.lireOuRejoindre("b", () => b.promesse);
    expect(r.enCours()).toBe(2);
    expect(r.etat("a")).not.toBeNull();
    expect(r.etat("c")).toBeNull();
    a.resoudre("");
    b.resoudre("");
  });
});
