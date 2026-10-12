import { describe, expect, it } from "vitest";

import { depuisUniteMineure, estNul, sommeDecimale } from "../somme-decimale.ts";

describe("sommeDecimale", () => {
  it("additionne sans perdre un millime", () => {
    expect(sommeDecimale(["404.600", "1023.400"])).toBe("1428.000");
    expect(sommeDecimale(["0.1", "0.2"])).toBe("0.300");
    expect(sommeDecimale(["2975.000", "1428.000", "404.600"])).toBe("4807.600");
  });

  it("accepte les entiers, la virgule, le négatif, et le vide", () => {
    expect(sommeDecimale(["12", "0,5"])).toBe("12.500");
    expect(sommeDecimale(["-10.250", "10.250"])).toBe("0.000");
    expect(sommeDecimale([])).toBe("0.000");
  });

  it("respecte le nombre de décimales demandé", () => {
    expect(sommeDecimale(["1.5", "2.25"], 2)).toBe("3.75");
    expect(sommeDecimale(["7", "8"], 0)).toBe("15");
  });

  it("refuse ce qui n'est pas un montant", () => {
    expect(() => sommeDecimale(["quatre"])).toThrow("montant illisible");
  });
});

describe("estNul", () => {
  it("reconnaît zéro sous toutes ses écritures", () => {
    expect(estNul("0")).toBe(true);
    expect(estNul("0.000")).toBe(true);
    expect(estNul("0.001")).toBe(false);
    expect(estNul("abc")).toBe(false);
  });
});

describe("depuisUniteMineure — de l'entier de la base à la chaîne du document", () => {
  it("rend les décimales du pack, pas celles qu'on devine", () => {
    // 613493 millimes = 613,493 dinars. À deux décimales, le MÊME entier vaut
    // 6134,93 : c'est le pack qui dit lequel, pas un « / 1000 » dans un écran.
    expect(depuisUniteMineure(613_493, 3)).toBe("613.493");
    expect(depuisUniteMineure(613_493, 2)).toBe("6134.93");
    expect(depuisUniteMineure(613_493, 0)).toBe("613493");
  });

  it("garde les zéros de queue : un document ne porte pas « 500.5 » pour 500,500", () => {
    expect(depuisUniteMineure(500_000, 3)).toBe("500.000");
  });

  it("et refuse ce qui n'est pas un entier : une unité mineure fractionnaire n'existe pas", () => {
    expect(() => depuisUniteMineure(1.5, 3)).toThrow(/non entière/);
  });
});
