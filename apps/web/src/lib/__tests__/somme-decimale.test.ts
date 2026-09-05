import { describe, expect, it } from "vitest";

import { estNul, sommeDecimale } from "../somme-decimale";

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
