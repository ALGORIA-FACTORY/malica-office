/**
 * « Utilisateurs inclus » compte le propriétaire (recette du 11 novembre
 * 2026, 5.4) : une société en Basic ou en Solo n'affiche plus « 0 / 0 ».
 */
import { describe, expect, it } from "vitest";

import { utilisateursInclus } from "../forfait";

describe("les utilisateurs comptent le propriétaire", () => {
  it("Basic ou Solo, le propriétaire seul : 1 / 1", () => {
    expect(utilisateursInclus({ sieges_occupes: 0, sieges_inclus: 0 })).toEqual({
      occupes: 1,
      inclus: 1,
    });
  });

  it("deux places incluses, une prise : 2 / 3", () => {
    expect(utilisateursInclus({ sieges_occupes: 1, sieges_inclus: 2 })).toEqual({
      occupes: 2,
      inclus: 3,
    });
  });

  it("une ligne non lue reste une absence", () => {
    expect(utilisateursInclus(null)).toBeNull();
    expect(utilisateursInclus({ sieges_occupes: null, sieges_inclus: 2 })).toBeNull();
  });
});
