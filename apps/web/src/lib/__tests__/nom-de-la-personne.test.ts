/**
 * Le nom saisi sert partout (recette du 11 novembre 2026, 4.4) : la pastille,
 * le salut, l'en-tête et l'équipe montraient l'adresse alors que le nom était
 * en base (`display_name`, posé à l'inscription).
 */
import { describe, expect, it } from "vitest";

import { identitePourAffichage, nomDeLaPersonne, nomPourSaluer } from "../nom-de-la-personne";

describe("la carte du Compte", () => {
  // Recette du 14 novembre 2026, C4 : la carte montrait « S » et l'e-mail au lieu du nom saisi.
  it("affiche le nom de l'inscription, son initiale, et l'e-mail en second", () => {
    expect(identitePourAffichage({ display_name: "Amira Trabelsi" }, "amira@exemple.test")).toEqual(
      { nom: "Amira Trabelsi", initiale: "A", courriel: "amira@exemple.test" },
    );
  });

  it("sans nom écrit, l'e-mail sert de nom et ne se répète pas", () => {
    expect(identitePourAffichage({ display_name: null }, "amira@exemple.test")).toEqual({
      nom: "amira@exemple.test",
      initiale: "A",
      courriel: null,
    });
  });

  it("sans nom ni e-mail, un trait et une initiale neutre", () => {
    expect(identitePourAffichage(null, null)).toEqual({ nom: "—", initiale: "·", courriel: null });
  });
});

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
