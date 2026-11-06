import { describe, expect, it } from "vitest";

import { repartir } from "../domain/decimal.ts";

const enTexte = (parts: ReturnType<typeof repartir>, n: number) => parts.map((p) => p.toFixed(n));

describe("repartir, au plus fort reste", () => {
  it("2 sur 60/60/60/20 sans décimales : aucune part négative, la somme tient (revue de #260)", () => {
    expect(enTexte(repartir("2", ["60", "60", "60", "20"], 0), 0)).toEqual(["1", "1", "0", "0"]);
  });

  it("au millime : 10 sur 600/400 donne 6 et 4, 190 donne 114 et 76", () => {
    expect(enTexte(repartir("10.000", ["600.000", "400.000"], 3), 3)).toEqual(["6.000", "4.000"]);
    expect(enTexte(repartir("190.000", ["600.000", "400.000"], 3), 3)).toEqual([
      "114.000",
      "76.000",
    ]);
  });

  it("le reliquat va au plus fort reste, pas à la dernière ligne", () => {
    // 0,010 en trois tiers : 0,004 / 0,003 / 0,003.
    expect(enTexte(repartir("0.010", ["1", "1", "1"], 3), 3)).toEqual(["0.004", "0.003", "0.003"]);
    // 1 sur 1/1/98 sans décimales : la grosse part prend l'unité.
    expect(enTexte(repartir("1", ["1", "1", "98"], 0), 0)).toEqual(["0", "0", "1"]);
  });

  it("la somme vaut toujours le montant, chaque part reste entre 0 et le montant", () => {
    for (const [total, poids, n] of [
      ["7", ["3", "3", "3"], 0],
      ["100.001", ["1", "2", "3", "4", "5", "6", "7"], 3],
      ["0.001", ["50", "50"], 3],
    ] as const) {
      const parts = repartir(total, poids, n);
      expect(parts.reduce((t, p) => t.plus(p)).toFixed(n)).toBe(Number(total).toFixed(n));
      expect(parts.every((p) => p.gte(0) && p.lte(total))).toBe(true);
    }
  });

  it("refuse un montant négatif ou des poids nuls", () => {
    expect(() => repartir("-1", ["1"], 0)).toThrow();
    expect(() => repartir("1", ["0", "0"], 0)).toThrow();
  });
});
