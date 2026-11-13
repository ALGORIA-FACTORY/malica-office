/**
 * Ce que « Toutes les sociétés » fait de chaque écran de la PME (maquette approuvée le
 * 13 novembre 2026) : jamais une redirection muette, et jamais un total qu'aucun moteur ne rend.
 */
import { describe, expect, it } from "vitest";

import { laPlusBasse, vueSousToutes } from "../toutes-les-societes";

describe("vueSousToutes — une réponse pour chaque écran, jamais « on redirige »", () => {
  it.each([
    ["/pme", "consolidee"],
    ["/pme/", "consolidee"],
    ["/pme/list", "consolidee"],
    ["/pme/dossier/achats", "consolidee"],
    ["/pme/echeances", "consolidee"],
    ["/pme/malica", "consolidee"],
    ["/pme/notifications", "consolidee"],
    ["/pme/societes", "consolidee"],
    ["/pme/tva", "uneParSociete"],
    ["/pme/charges", "uneParSociete"],
    ["/pme/capturer", "choisirLaSociete"],
    ["/pme/piece/abc", "laSocieteDeLaPiece"],
    ["/pme/coffre", "inchangee"],
    ["/pme/reglages", "inchangee"],
  ] as const)("%s → %s", (chemin, vue) => {
    expect(vueSousToutes(chemin)).toBe(vue);
  });
});

describe("laPlusBasse — les lectures sous « Toutes »", () => {
  it("nomme la société qui a le moins de lectures, sans les additionner", () => {
    const r = laPlusBasse([
      { id: "a", name: "Atelier Zitouna", restantes: 30, droit: 30 },
      { id: "m", name: "Medina Textile", restantes: 4, droit: 30 },
      { id: "s", name: "SOTUMAG SARL", restantes: 12, droit: 30 },
    ]);
    expect(r).toEqual({ id: "m", name: "Medina Textile", restantes: 4, droit: 30 });
  });

  it("lit une valeur en chaîne et ignore une société dont le forfait est inconnu", () => {
    const r = laPlusBasse([
      { id: "a", name: "A", restantes: null, droit: null },
      { id: "b", name: "B", restantes: "7", droit: "30" },
    ]);
    expect(r?.id).toBe("b");
    expect(r?.restantes).toBe(7);
  });

  it("à égalité, la première par ordre alphabétique", () => {
    const r = laPlusBasse([
      { id: "z", name: "Zeta", restantes: 3, droit: 30 },
      { id: "a", name: "Alpha", restantes: 3, droit: 30 },
    ]);
    expect(r?.id).toBe("a");
  });

  it("ne dit rien quand aucun forfait n'est connu", () => {
    expect(laPlusBasse([{ id: "a", name: "A", restantes: null, droit: null }])).toBeNull();
    expect(laPlusBasse([])).toBeNull();
  });
});
