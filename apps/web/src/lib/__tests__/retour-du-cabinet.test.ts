import { describe, expect, it } from "vitest";
import { LOCALES, MESSAGES } from "@malica/socle/messages";

import {
  dernierRetourParPiece,
  FAIT_DU_GESTE,
  LIBELLE_DU_GESTE,
  lueSansConfirmation,
  sortiesDuRetour,
} from "@/lib/retour-du-cabinet";

/** Maquette « Retours du cabinet et pièces à confirmer », 25 octobre 2026. */
describe("un retour du cabinet dit un geste", () => {
  it("chaque geste se dit, et ce qui le prouve aussi, dans les trois langues", () => {
    const cles = [...Object.values(LIBELLE_DU_GESTE), ...Object.values(FAIT_DU_GESTE)];
    for (const locale of LOCALES)
      for (const cle of cles) expect(MESSAGES[locale][cle], `${locale} ${cle}`).toBeTruthy();
  });

  it("une pièce retournée a toujours toutes ses sorties, le geste demandé d'abord", () => {
    const toutes = ["renvoyer", "reprendre_photo", "repondre", "garder", "supprimer"];
    for (const geste of Object.keys(LIBELLE_DU_GESTE) as Array<keyof typeof LIBELLE_DU_GESTE>)
      for (const fait of [false, true]) {
        const sorties = sortiesDuRetour(geste, fait);
        expect(new Set(sorties).size, `${geste} sans doublon`).toBe(sorties.length);
        for (const s of toutes) expect(sorties, `${geste} ${String(fait)}`).toContain(s);
      }
    expect(sortiesDuRetour("joindre_document", false).slice(0, 2)).toEqual(["geste", "renvoyer"]);
    expect(sortiesDuRetour("joindre_document", true).slice(0, 2)).toEqual(["renvoyer", "geste"]);
    // Le geste qu'une sortie porte déjà ne se dit pas deux fois.
    expect(sortiesDuRetour("reprendre_photo", false)[0]).toBe("reprendre_photo");
    expect(sortiesDuRetour("repondre", false)[0]).toBe("repondre");
    expect(sortiesDuRetour("demander_suppression", false)).not.toContain("geste");
  });

  it("le cabinet décide d'une pièce lue ou proposée, jamais d'une pièce inscrite", () => {
    expect(lueSansConfirmation("lue", false)).toBe(true);
    expect(lueSansConfirmation("proposee", false)).toBe(true);
    expect(lueSansConfirmation("lue", true)).toBe(false);
    expect(lueSansConfirmation("retournee", false)).toBe(false);
    expect(lueSansConfirmation("comptabilisee", false)).toBe(false);
  });
});

describe("dernierRetourParPiece", () => {
  const n = (id: string, piece: string | undefined, createdAt: string) => ({
    id,
    piece,
    createdAt,
  });

  it("garde une seule carte par pièce : le retour le plus récent", () => {
    const r = dernierRetourParPiece(
      [
        n("a", "p1", "2026-10-20T10:00:00Z"),
        n("b", "p1", "2026-10-28T10:00:00Z"),
        n("c", "p2", "2026-10-25T10:00:00Z"),
      ],
      (x) => x.piece,
    );
    expect(r.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("écarte un retour sans pièce", () => {
    expect(
      dernierRetourParPiece([n("a", undefined, "2026-10-20T10:00:00Z")], (x) => x.piece),
    ).toEqual([]);
  });
});
