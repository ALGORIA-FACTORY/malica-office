import { describe, expect, it } from "vitest";

import { dansLOrdreVu } from "./ordre-de-revue";

const r = (pieceId: string, statut = "recue") => ({ pieceId, statut });

describe("l'ordre de la revue", () => {
  it("garde l'ordre montré quand une pièce ouverte recule dans la file", () => {
    // La file montrée : a, b, c. Ouverte, « a » devient « Vue » et la base la range après c.
    const frais = [r("b"), r("c"), r("a", "vue")];
    expect(dansLOrdreVu(["a", "b", "c"], frais).map((x) => x.pieceId)).toEqual(["a", "b", "c"]);
    // Le statut, lui, est celui de la base.
    expect(dansLOrdreVu(["a", "b", "c"], frais)[0]!.statut).toBe("vue");
  });

  it("range à la fin une pièce arrivée depuis, et oublie une pièce sortie", () => {
    expect(dansLOrdreVu(["a", "b"], [r("b"), r("n")]).map((x) => x.pieceId)).toEqual(["b", "n"]);
  });

  it("suit la base tant que rien n'a été montré", () => {
    expect(dansLOrdreVu(null, [r("x"), r("y")]).map((x) => x.pieceId)).toEqual(["x", "y"]);
  });
});
