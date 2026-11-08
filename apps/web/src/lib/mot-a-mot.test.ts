import { describe, expect, it } from "vitest";

import { DUREE_MAX, PAS_MS, morceaux, motsParPas, texteMontre } from "./mot-a-mot";

describe("la réponse s'écrit mot à mot", () => {
  it("rend le texte exact, retours compris, une fois tous les mots montrés", () => {
    const t = "Bonjour.\n\nLa TVA  se déclare le 28.";
    expect(morceaux(t).join("")).toBe(t);
    expect(texteMontre(t, 999)).toBe(t);
  });

  it("montre les premiers mots seulement", () => {
    expect(texteMontre("un deux trois", 2)).toBe("un deux ");
    expect(texteMontre("un deux trois", 0)).toBe("");
  });

  it("une longue réponse s'écrit en DUREE_MAX au plus", () => {
    const total = 2000;
    const pas = Math.ceil(total / motsParPas(total));
    expect(pas * PAS_MS).toBeLessThanOrEqual(DUREE_MAX + PAS_MS);
    expect(motsParPas(10)).toBe(1);
  });
});
