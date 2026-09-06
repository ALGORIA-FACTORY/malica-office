import { describe, expect, it } from "vitest";

import {
  fermerLaDerniereSuperposition,
  nombreDeSuperpositions,
  ouvrirSuperposition,
} from "../superpositions";

describe("la pile des superpositions", () => {
  it("ferme la dernière ouverte, puis la précédente, puis ne ferme plus rien", () => {
    const fermees: string[] = [];
    const retirerA = ouvrirSuperposition(() => fermees.push("a"));
    ouvrirSuperposition(() => fermees.push("b"));
    expect(nombreDeSuperpositions()).toBe(2);

    expect(fermerLaDerniereSuperposition()).toBe(true);
    expect(fermees).toEqual(["b"]);
    expect(fermerLaDerniereSuperposition()).toBe(true);
    expect(fermees).toEqual(["b", "a"]);
    expect(fermerLaDerniereSuperposition()).toBe(false);
    // Retirer ce qui est déjà parti ne casse rien.
    retirerA();
    expect(nombreDeSuperpositions()).toBe(0);
  });

  it("une superposition fermée par son propre bouton quitte la pile", () => {
    const retirer = ouvrirSuperposition(() => undefined);
    retirer();
    expect(fermerLaDerniereSuperposition()).toBe(false);
  });
});
