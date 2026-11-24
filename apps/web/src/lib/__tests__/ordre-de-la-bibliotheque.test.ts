/**
 * L'ordre de la Bibliothèque, et les touches qui le parcourent au bureau.
 *
 * Garantit que les mois vont du plus récent au plus ancien en gardant l'ordre reçu
 * dans un mois, que la pièce ouverte sait son rang et ses deux voisines dans ce même
 * ordre, que l'espace privé et un document joint n'y comptent pas, et que J / K ne
 * volent jamais une lettre tapée dans un champ ni un raccourci du navigateur.
 */
import { describe, expect, it } from "vitest";

import type { PieceLue } from "@malica/socle/ports/repositories";

import {
  groupesParMois,
  piecesDeLaBibliotheque,
  placeDansLaBibliotheque,
  toucheDeNavigation,
} from "../ordre-de-la-bibliotheque";

const piece = (id: string, dateDocument: string | null, extra: Partial<PieceLue> = {}) =>
  ({
    id,
    dateDocument,
    createdAt: "2026-11-01T10:00:00Z",
    vis: "entite",
    status: "lue",
    ...extra,
  }) as PieceLue;

const touche = (key: string, extra: Partial<Parameters<typeof toucheDeNavigation>[0]> = {}) =>
  toucheDeNavigation({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    ...extra,
  });

describe("groupesParMois", () => {
  it("met le mois le plus récent devant et garde l'ordre reçu dans un mois", () => {
    const g = groupesParMois([
      piece("a", "2026-03-10"),
      piece("b", "2026-07-02"),
      piece("c", "2026-03-01"),
    ]);
    expect(g.map(([cle, ps]) => [cle, ps.map((p) => p.id)])).toEqual([
      ["2026-07", ["b"]],
      ["2026-03", ["a", "c"]],
    ]);
  });
});

describe("placeDansLaBibliotheque", () => {
  const lot = [piece("a", "2026-03-10"), piece("b", "2026-07-02"), piece("c", "2026-03-01")];

  it("donne le rang et les voisines dans l'ordre de la Bibliothèque", () => {
    expect(placeDansLaBibliotheque(lot, "a")).toEqual({
      rang: 2,
      total: 3,
      precedente: "b",
      suivante: "c",
    });
    expect(placeDansLaBibliotheque(lot, "b")).toMatchObject({ rang: 1, precedente: null });
    expect(placeDansLaBibliotheque(lot, "c")).toMatchObject({ rang: 3, suivante: null });
  });

  it("ne place pas une pièce absente de la liste", () => {
    expect(placeDansLaBibliotheque(lot, "z")).toBeNull();
  });

  it("ne compte ni l'espace privé ni un document joint", () => {
    const montrees = piecesDeLaBibliotheque([
      piece("a", "2026-03-10"),
      piece("prive", "2026-03-11", { vis: "personnel" }),
      piece("bl", "2026-03-12", { jointe: true }),
    ]);
    expect(montrees.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("toucheDeNavigation", () => {
  it("J va à la suivante, K à la précédente, en minuscule comme en majuscule", () => {
    expect(touche("j")).toBe("suivante");
    expect(touche("K")).toBe("precedente");
    expect(touche("x")).toBeNull();
  });

  it("laisse les raccourcis du navigateur", () => {
    expect(touche("j", { ctrlKey: true })).toBeNull();
    expect(touche("k", { metaKey: true })).toBeNull();
    expect(touche("j", { altKey: true })).toBeNull();
  });

  it("ne prend jamais une lettre tapée dans un champ", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(touche("j", { target: { tagName } as unknown as EventTarget })).toBeNull();
    }
    expect(
      touche("k", { target: { isContentEditable: true } as unknown as EventTarget }),
    ).toBeNull();
  });
});
