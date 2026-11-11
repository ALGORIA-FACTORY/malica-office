/**
 * Le journal du jour, côté écran — naviguer de jour en jour et dire l'écart.
 *
 * Garantit que l'on recule et avance d'un jour à travers les mois et les années, que
 * l'adresse ne donne un jour que s'il existe au calendrier (le 30 février est refusé),
 * et que l'écart entre deux états ne dit que ses parties non nulles.
 */
import { describe, expect, it } from "vitest";

import { jourLisible, jourVoisin, nombreDeChangements, partiesDeLEcart } from "../journal-du-jour";

describe("le journal du jour, côté écran", () => {
  it("recule et avance d'un jour, mois et années compris", () => {
    expect(jourVoisin("2026-03-01", -1)).toBe("2026-02-28");
    expect(jourVoisin("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("ne lit dans l'adresse qu'un vrai jour", () => {
    expect(jourLisible("2026-10-28")).toBe("2026-10-28");
    expect(jourLisible("2026-02-30")).toBeUndefined();
    expect(jourLisible("2026-13-45")).toBeUndefined();
    expect(jourLisible("0000-00-00")).toBeUndefined();
    expect(jourLisible("28/10/2026")).toBeUndefined();
    expect(jourLisible(20261028)).toBeUndefined();
  });

  it("ne dit que les parties non nulles d'un écart — « retirées » seul s'il est seul", () => {
    const seul = { ajoutees: 0, contrePassees: 0, retirees: 1, fuseauChange: false };
    expect(partiesDeLEcart(seul)).toEqual([{ cle: "cab.jdj.ecart.retirees", n: 1 }]);
    expect(nombreDeChangements(seul)).toBe(1);
    expect(
      partiesDeLEcart({ ajoutees: 2, contrePassees: 1, retirees: 0, fuseauChange: false }),
    ).toEqual([
      { cle: "cab.jdj.ecart.ajoutees", n: 2 },
      { cle: "cab.jdj.ecart.contrePassees", n: 1 },
    ]);
  });
});
