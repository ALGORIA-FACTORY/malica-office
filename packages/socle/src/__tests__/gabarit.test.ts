import { describe, expect, it } from "vitest";

import { remplirLeGabarit } from "../gabarit.ts";

describe("remplirLeGabarit", () => {
  it("place chaque valeur, autant de fois qu'elle est citée", () => {
    expect(remplirLeGabarit("{a} puis {b}, encore {a}", { a: "x", b: 2 })).toBe(
      "x puis 2, encore x",
    );
  });

  it("insère une valeur telle quelle, même si elle ressemble à un motif de remplacement", () => {
    for (const v of ["$&", "$'", "$`", "$$", "$1"])
      expect(remplirLeGabarit("« {valeur} »", { valeur: v })).toBe(`« ${v} »`);
  });
});
