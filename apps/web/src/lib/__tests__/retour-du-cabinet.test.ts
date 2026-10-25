import { describe, expect, it } from "vitest";
import { LOCALES, MESSAGES } from "@malica/socle/messages";

import { FAIT_DU_GESTE, LIBELLE_DU_GESTE, lueSansConfirmation } from "@/lib/retour-du-cabinet";

/** Maquette « Retours du cabinet et pièces à confirmer », 25 octobre 2026. */
describe("un retour du cabinet dit un geste", () => {
  it("chaque geste se dit, et ce qui le prouve aussi, dans les trois langues", () => {
    const cles = [...Object.values(LIBELLE_DU_GESTE), ...Object.values(FAIT_DU_GESTE)];
    for (const locale of LOCALES)
      for (const cle of cles) expect(MESSAGES[locale][cle], `${locale} ${cle}`).toBeTruthy();
  });

  it("le cabinet décide d'une pièce lue ou proposée, jamais d'une pièce inscrite", () => {
    expect(lueSansConfirmation("lue", false)).toBe(true);
    expect(lueSansConfirmation("proposee", false)).toBe(true);
    expect(lueSansConfirmation("lue", true)).toBe(false);
    expect(lueSansConfirmation("retournee", false)).toBe(false);
    expect(lueSansConfirmation("comptabilisee", false)).toBe(false);
  });
});
