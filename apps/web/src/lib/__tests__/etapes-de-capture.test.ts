/**
 * Les étapes de la capture — celles qui sont comptées en tête de l'écran.
 *
 * Garantit UNE numérotation, et qu'elle ne bouge pas en route (recette du
 * 13 novembre 2026, G6a : le total passait de 8 à 6 quand les questions et les
 * dates se révélaient vides). Les questions et les dates sont des temps de
 * « Vérifier » : elles ne se comptent pas à part.
 */
import { describe, expect, it } from "vitest";

import { etapesVisibles, rangDeLEtape } from "@/lib/etapes-de-capture";

describe("les étapes comptées en tête de la capture", () => {
  it("la société : six étapes, quoi que les questions et les dates révèlent", () => {
    expect(etapesVisibles(false)).toEqual([1, 2, 3, 4, 7, 8]);
  });
  it("pour moi : « Pour qui ? » puis la fin", () => {
    expect(etapesVisibles(true)).toEqual([1, 8]);
  });
  it("les questions (5) et les dates (6) sont des temps de « Vérifier » (4)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((e) => rangDeLEtape(e, false))).toEqual([
      1, 2, 3, 4, 4, 4, 5, 6,
    ]);
  });
  it("pour moi : la fin est la deuxième", () => {
    expect([1, 8].map((e) => rangDeLEtape(e, true))).toEqual([1, 2]);
  });
});
