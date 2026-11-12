/**
 * Le nom saisi sert partout (recette du 11 novembre 2026, 4.4) : la pastille,
 * le salut, l'en-tête et l'équipe montraient l'adresse alors que le nom était
 * en base (`display_name`, posé à l'inscription).
 */
import { describe, expect, it } from "vitest";

import { nomDeLaPersonne, nomPourSaluer } from "../nom-de-la-personne";

describe("le nom de la personne", () => {
  it("le nom de l'inscription sert quand rien d'autre n'est écrit", () => {
    expect(nomDeLaPersonne({ display_name: "Samia Ben Salah" })).toBe("Samia Ben Salah");
    expect(nomPourSaluer({ display_name: "Samia Ben Salah", prenom: null })).toBe(
      "Samia Ben Salah",
    );
  });

  it("le prénom et le nom des Réglages l'emportent", () => {
    const p = { prenom: "Samia", nom: "Ben Salah", display_name: "S. B. S." };
    expect(nomDeLaPersonne(p)).toBe("Samia Ben Salah");
    expect(nomPourSaluer(p)).toBe("Samia");
  });

  it("sans nom, rien n'est deviné", () => {
    expect(nomDeLaPersonne({ prenom: " ", nom: null, display_name: "" })).toBeNull();
    expect(nomPourSaluer(null)).toBeNull();
  });
});
