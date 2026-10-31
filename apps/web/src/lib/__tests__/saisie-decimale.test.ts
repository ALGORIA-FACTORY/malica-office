import { describe, expect, it } from "vitest";
import { saisieDecimale } from "@malica/socle/saisie-decimale";
import { montant } from "../lisible";

/*
 * La règle de saisie vit au Socle (`packages/socle/src/saisie-decimale.ts`),
 * avec ses épreuves. Ici, l'aller-retour avec l'écran : ce qu'il affiche en
 * français se relit à l'identique.
 */
describe("saisie d'un montant", () => {
  it("relit ce que l'écran affiche, milliers compris", () => {
    expect(saisieDecimale(montant("1234.500", "fr"))).toBe("1234.500");
  });
});
