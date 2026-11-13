// @vitest-environment jsdom
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
