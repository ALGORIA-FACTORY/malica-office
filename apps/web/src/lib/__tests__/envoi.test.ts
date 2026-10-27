import { describe, expect, it } from "vitest";

import { fusionnerLEnvoi, pieceSuivanteATransmettre, resteATransmettre } from "../envoi";

const p = (id: string, vis = "entite", status = "lue", gardeeLe: string | null = null) => ({
  id,
  vis,
  status,
  gardeeLe,
});

describe("ce qui reste à transmettre", () => {
  it("une pièce de la société, ni gardée ni retournée", () => {
    expect(resteATransmettre(p("a"))).toBe(true);
  });

  it("jamais l'espace privé, une pièce gardée, partie ou retournée", () => {
    expect(resteATransmettre(p("a", "personnel"))).toBe(false);
    expect(resteATransmettre(p("a", "entite", "lue", "2026-10-27"))).toBe(false);
    expect(resteATransmettre(p("a", "partage"))).toBe(false);
    expect(resteATransmettre(p("a", "entite", "retournee"))).toBe(false);
  });
});

describe("la pièce suivante", () => {
  it("prend la suivante dans l'ordre, puis reprend au début", () => {
    const liste = [p("a"), p("b", "partage"), p("c"), p("d")];
    expect(pieceSuivanteATransmettre(liste, "c")?.id).toBe("d");
    expect(pieceSuivanteATransmettre(liste, "d")?.id).toBe("a");
  });

  it("ne rend jamais la pièce qu'on vient d'envoyer, et rien quand il n'y a plus rien", () => {
    expect(pieceSuivanteATransmettre([p("a")], "a")).toBeNull();
    expect(pieceSuivanteATransmettre([p("a", "partage"), p("b", "personnel")], "a")).toBeNull();
  });
});

describe("réessayer une pièce restée", () => {
  it("garde les autres restées, jamais retentées", () => {
    const avant = {
      parties: ["a"],
      restees: [
        { id: "b", refus: null },
        { id: "c", refus: null },
      ],
    };
    const apres = fusionnerLEnvoi(avant, ["b"], { parties: ["b"], restees: [] });
    expect(apres).toEqual({ parties: ["a", "b"], restees: [{ id: "c", refus: null }] });
  });

  it("remplace la raison d'une pièce retentée et encore refusée", () => {
    const avant = { parties: [], restees: [{ id: "b", refus: null }] };
    const apres = fusionnerLEnvoi(avant, ["b"], {
      parties: [],
      restees: [{ id: "b", refus: "Licence impayée" }],
    });
    expect(apres.restees).toEqual([{ id: "b", refus: "Licence impayée" }]);
  });
});
