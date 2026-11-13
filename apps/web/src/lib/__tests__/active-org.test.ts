// @vitest-environment jsdom
/**
 * La vue « Toutes les sociétés » de l'en-tête PME se garde pour la session : un rechargement
 * ne doit pas la perdre en silence (recette du 13 novembre 2026), et un stockage de session
 * indisponible ne doit jamais faire échouer l'écran.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { readVueConsolidee, writeVueConsolidee } from "../active-org";

describe("la vue « Toutes les sociétés » survit au rechargement", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("est fermée par défaut", () => {
    expect(readVueConsolidee()).toBe(false);
  });

  it("se relit après l'avoir ouverte, et se referme", () => {
    writeVueConsolidee(true);
    expect(readVueConsolidee()).toBe(true);
    writeVueConsolidee(false);
    expect(readVueConsolidee()).toBe(false);
  });

  it("ne casse pas quand le stockage de session est indisponible", () => {
    const vrai = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("bloqué");
      },
      configurable: true,
    });
    try {
      expect(readVueConsolidee()).toBe(false);
      expect(() => writeVueConsolidee(true)).not.toThrow();
    } finally {
      if (vrai) Object.defineProperty(window, "sessionStorage", vrai);
    }
  });
});
