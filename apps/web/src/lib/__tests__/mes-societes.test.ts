import { describe, expect, it } from "vitest";

import { type Ligne, plier, trierLesLignes } from "../mes-societes";

/* « Mes sociétés » (planche 13) : ce qui attend d'abord, ou A → Z, ou les épinglées. */
const l = (id: string, name: string, aTraiter = 0, aLire = 0, enRetard = 0): Ligne => ({
  id,
  name,
  matricule: null,
  aTraiter,
  aLire,
  enRetard,
});
const lignes = [
  l("b", "Byrsa", 0, 9),
  l("a", "ALGORIA", 3, 0),
  l("z", "Atelier Zitouna", 0, 0, 5),
  l("c", "Carthage", 0, 0),
];

describe("le tri de « Mes sociétés »", () => {
  it("ce qui attend : le retard d'abord, puis le geste, puis la lecture, puis A → Z", () => {
    expect(trierLesLignes(lignes, "attend", "fr", []).map((x) => x.id)).toEqual([
      "z",
      "a",
      "b",
      "c",
    ]);
  });

  it("A → Z", () => {
    expect(trierLesLignes(lignes, "az", "fr", []).map((x) => x.id)).toEqual(["a", "z", "b", "c"]);
  });

  it("les épinglées seules, de A à Z", () => {
    expect(trierLesLignes(lignes, "epinglees", "fr", ["c", "a"]).map((x) => x.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("la recherche ignore accents et casse", () => {
    expect(plier("Société Générale")).toBe("societe generale");
  });
});
