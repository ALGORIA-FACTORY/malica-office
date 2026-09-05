/**
 * Le contrat de la carte fiscale.
 *
 * Ce qu'on éprouve ici n'est pas la lecture — c'est le REFUS. Un contrat trop
 * permissif laisse passer un régime fiscal inventé, et la fiche qui en découle
 * décide de la moitié des réponses.
 */
import { describe, expect, it } from "vitest";

import { CarteFiscaleV1, champsManquants } from "../contracts/carte-fiscale.v1";

const NUE = { contract: "carte_fiscale.v1" as const };

describe("une carte illisible reste une carte", () => {
  it("accepte une lecture entièrement vide", () => {
    const r = CarteFiscaleV1.safeParse(NUE);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.matricule_fiscal).toBeNull();
  });

  it("dit ce qui manque au lieu de le combler", () => {
    const carte = CarteFiscaleV1.parse(NUE);
    const manquants = champsManquants(carte);
    expect(manquants).toContain("matricule_fiscal");
    expect(manquants).toContain("regime_imposition");
    expect(manquants).toContain("regime_tva");
  });
});

describe("les formes que la base attend", () => {
  it("refuse une date qui n'est pas une date", () => {
    expect(CarteFiscaleV1.safeParse({ ...NUE, debut_activite: "01/2020" }).success).toBe(false);
    expect(CarteFiscaleV1.safeParse({ ...NUE, debut_activite: "2020-13-01" }).success).toBe(true);
  });

  it("refuse une clôture qui porte une année", () => {
    expect(CarteFiscaleV1.safeParse({ ...NUE, cloture_exercice: "2026-12-31" }).success).toBe(
      false,
    );
    expect(CarteFiscaleV1.safeParse({ ...NUE, cloture_exercice: "12-31" }).success).toBe(true);
  });

  it("refuse un mois ou un jour impossibles", () => {
    expect(CarteFiscaleV1.safeParse({ ...NUE, cloture_exercice: "13-01" }).success).toBe(false);
    expect(CarteFiscaleV1.safeParse({ ...NUE, cloture_exercice: "06-32" }).success).toBe(false);
  });

  it("refuse une chaîne vide, qui n'est pas une absence", () => {
    // « » n'est pas « rien lu » : c'est un champ lu comme vide, ce qui ne veut
    // rien dire. L'absence s'écrit null.
    expect(CarteFiscaleV1.safeParse({ ...NUE, matricule_fiscal: "" }).success).toBe(false);
  });

  it("refuse une confiance hors bornes", () => {
    expect(
      CarteFiscaleV1.safeParse({ ...NUE, field_confidence: { matricule_fiscal: 1.4 } }).success,
    ).toBe(false);
  });
});

describe("une carte complète passe entière", () => {
  it("garde chaque champ tel quel", () => {
    const r = CarteFiscaleV1.parse({
      ...NUE,
      raison_sociale: "ALGORIA FACTORY",
      matricule_fiscal: "1234567/A/M/000",
      regime_imposition: "reel",
      regime_tva: "assujetti",
      activite: "Conseil en systèmes informatiques",
      debut_activite: "2020-03-01",
      cloture_exercice: "12-31",
      field_confidence: { matricule_fiscal: 0.98 },
    });
    expect(r.matricule_fiscal).toBe("1234567/A/M/000");
    expect(r.regime_imposition).toBe("reel");
    expect(champsManquants(r)).toEqual([]);
  });

  it("ne normalise pas le matricule : il se cite tel qu'imprimé", () => {
    const r = CarteFiscaleV1.parse({ ...NUE, matricule_fiscal: "1234567 A M 000" });
    expect(r.matricule_fiscal).toBe("1234567 A M 000");
  });
});
