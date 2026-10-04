/**
 * Où l'application va chercher son API — et pourquoi elle refuse de deviner.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Le 4 octobre 2026, personne ne pouvait se connecter au site du staging. Le
 * message affiché accusait les identifiants ; ils étaient bons. En vérité
 * AUCUNE requête ne partait : le paquet livré portait `VITE_API_URL` vide, et
 * la règle « en production, on ne devine pas » levait avant le premier appel.
 *
 * La règle est juste. Ce qui manquait, c'est de pouvoir DÉCLARER la même
 * origine — qui est le cas normal d'un site servi derrière un relais : le
 * navigateur parle à l'adresse publique, et Caddy route `/rpc`, `/auth/*` et
 * le reste vers l'API. Ce n'est pas une devinette, c'est une configuration.
 *
 * D'où la distinction tenue ici : vide = absente = on lève ; « / » = même
 * origine, dite explicitement = on l'accepte.
 */
import { describe, expect, it } from "vitest";

import { resoudreApi } from "../base";

describe("l'adresse de l'API", () => {
  describe("en production", () => {
    it("lève quand rien n'est déclaré : deviner serait pire que s'arrêter", () => {
      expect(() => resoudreApi(undefined, true)).toThrow(/VITE_API_URL absente/);
      expect(() => resoudreApi("", true)).toThrow(/VITE_API_URL absente/);
      expect(() => resoudreApi("   ", true)).toThrow(/VITE_API_URL absente/);
    });

    it("accepte « / » comme déclaration de la même origine", () => {
      // C'est le cas du site derrière Caddy : l'API est servie par la même
      // origine publique. Le rendu est la chaîne vide, que le transport
      // concatène devant « /auth/connexion » — donc une adresse relative.
      expect(resoudreApi("/", true)).toBe("");
    });

    it("garde une adresse absolue telle qu'elle est déclarée", () => {
      expect(resoudreApi("https://staging.malica-office.algoria-factory.com", true)).toBe(
        "https://staging.malica-office.algoria-factory.com",
      );
      expect(resoudreApi("https://exemple.tn/", true)).toBe("https://exemple.tn");
    });
  });

  describe("en développement", () => {
    it("passe par le relais du serveur web quand rien n'est déclaré", () => {
      expect(resoudreApi(undefined, false)).toBe("");
    });

    it("ignore une adresse de boucle locale : le relais fait mieux", () => {
      expect(resoudreApi("http://localhost:3000", false)).toBe("");
    });

    it("respecte une adresse distante déclarée : c'est une décision", () => {
      expect(resoudreApi("https://staging.malica-office.algoria-factory.com", false)).toBe(
        "https://staging.malica-office.algoria-factory.com",
      );
    });
  });
});
