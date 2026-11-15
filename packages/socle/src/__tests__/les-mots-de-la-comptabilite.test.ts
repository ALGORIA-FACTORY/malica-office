/**
 * Les mots qui parlent de la comptabilité (recette du 13 novembre 2026, D10 et G5).
 *
 * La société a une COMPTABILITÉ, pas un comptable : « vous serez prévenu s'il a
 * une question » parlait d'un homme. Et la fiche compte des documents, pas des
 * pièces : la pièce elle-même et son joint font deux documents.
 */
import { describe, expect, it } from "vitest";

import { MESSAGES, type Locale } from "../messages.ts";

const LANGUES: readonly Locale[] = ["fr", "en", "ar"];
const cle = (l: Locale, k: string) => (MESSAGES[l] as Record<string, string | undefined>)[k];

describe("les mots de la comptabilité", () => {
  it("« si elle a une question » : la comptabilité, au féminin", () => {
    for (const k of [
      "envoi.piece.suite",
      "envoi.lot.chez",
      "envoi.lot.chez#one",
      "envoi.lot.chez#other",
    ])
      expect(cle("fr", k), k).toMatch(/si elle a une question/);
    for (const k of [
      "envoi.piece.suite",
      "envoi.lot.chez",
      "envoi.lot.chez#one",
      "envoi.lot.chez#other",
    ])
      expect(cle("fr", k), k).not.toMatch(/s'il a une question/);
  });

  it("l'arabe ne dit plus « لديه » (lui) mais « لديها » (elle)", () => {
    for (const k of [
      "envoi.piece.suite",
      "envoi.lot.chez",
      "envoi.lot.chez#one",
      "envoi.lot.chez#other",
    ]) {
      expect(cle("ar", k), k).toContain("لديها");
      expect(cle("ar", k), k).not.toContain("لديه ");
    }
  });

  it("l'anglais est déjà neutre", () => {
    expect(cle("en", "envoi.piece.suite")).toMatch(/if they have a question/);
  });

  it("les documents liés se comptent en documents, dans les trois langues", () => {
    expect(cle("fr", "pme.piece.chaine.pieces")).toMatch(/DOCUMENT/);
    expect(cle("fr", "pme.piece.chaine.pieces#one")).toMatch(/DOCUMENT$/);
    expect(cle("fr", "pme.piece.chaine.pieces#other")).toMatch(/DOCUMENTS$/);
    expect(cle("fr", "pme.piece.chaine.pieces")).not.toMatch(/PIÈCE/);
  });

  it("« Rangée » : un mot pour la pièce d'une société sans comptabilité, dans les trois langues", () => {
    for (const l of LANGUES) expect(cle(l, "statut.pme.rangee"), l).toBeTruthy();
    expect(cle("fr", "statut.pme.rangee")).toBe("Rangée");
  });

  it("« Rangée » : jamais « cabinet » à l'écran", () => {
    for (const k of ["statut.pme.rangee"])
      for (const l of LANGUES) expect(cle(l, k) ?? "", `${l}/${k}`).not.toMatch(/cabinet/i);
  });
});
