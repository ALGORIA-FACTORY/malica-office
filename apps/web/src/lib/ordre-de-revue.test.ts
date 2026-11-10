/**
 * L'ordre de la revue — la file ne se réordonne pas sous les pieds du cabinet.
 *
 * Garantit que, d'une pièce à l'autre, l'ordre montré au départ est gardé même quand la
 * base range autrement une pièce ouverte, qu'une pièce arrivée depuis va à la fin, qu'une
 * pièce sortie est oubliée, et que l'ordre s'oublie au retour à la file.
 */
import { describe, expect, it } from "vitest";

import { dansLOrdreVu, oublierLOrdre, ordreDeLaRevue, retenirLOrdre } from "./ordre-de-revue";

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

  it("garde l'ordre d'une pièce à l'autre, et l'oublie au retour à la file", () => {
    retenirLOrdre("cab", ["a", "b", "c"]);
    // L'écran remonté sur « b » retrouve l'ordre de départ, pas la file retriée.
    expect(ordreDeLaRevue("cab", "b")).toEqual(["a", "b", "c"]);
    // Une pièce hors de cette revue en commence une autre.
    expect(ordreDeLaRevue("cab", "z")).toBeNull();
    oublierLOrdre("cab");
    expect(ordreDeLaRevue("cab", "a")).toBeNull();
  });
});
