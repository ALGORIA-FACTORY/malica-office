/**
 * La lecture d'une réponse de conseil : ce qu'on croit du modèle, et ce
 * qu'on relit dans ce qu'on lui a montré.
 */
import { describe, expect, it } from "vitest";

import type { FragmentDeDroit } from "../corpus.server";
import { lireReponseDeConseil, resoudreLesSources } from "../conseil.server";

const fragment = (corpus: string, numero: string): FragmentDeDroit => ({
  corpus,
  numero,
  validFrom: "2024-01-01",
  validTo: null,
  ordinal: 0,
  langue: "fr",
  extrait: "…",
  statut: "en_vigueur",
  abrogePar: null,
  nature: "Loi",
  autorite: "normative",
  opposableA: null,
  jortReference: null,
  provenance: "verbatim",
  distance: 0.2,
});

const FRAGMENTS = [fragment("CTVA", "9"), fragment("CTVA", "10"), fragment("CIRPPIS", "12")];

describe("lireReponseDeConseil", () => {
  it("lit l'objet, et ne garde que les sources transmises", () => {
    const lu = lireReponseDeConseil(
      JSON.stringify({
        reponse: "Oui, sous condition.",
        conseil: true,
        theme: "Déduction de TVA sur véhicule",
        certitude: 0.72,
        sources: [
          { corpus: "CTVA", numero: "9" },
          { corpus: "CTVA", numero: "999" },
        ],
        doute: "La qualité du vendeur n'est pas établie.",
      }),
      FRAGMENTS,
    );
    expect(lu.structuree).toBe(true);
    expect(lu.conseil).toBe(true);
    expect(lu.reponse).toBe("Oui, sous condition.");
    expect(lu.certitude).toBe(0.72);
    expect(lu.sources.map((s) => `${s.corpus} ${s.numero}`)).toEqual(["CTVA 9"]);
    expect(lu.theme).toBe("Déduction de TVA sur véhicule");
  });

  it("sans source relue, la certitude tombe à zéro quoi qu'elle en dise", () => {
    const lu = lireReponseDeConseil(
      JSON.stringify({
        reponse: "Je n'ai pas le texte.",
        conseil: true,
        certitude: 0.95,
        sources: [{ corpus: "CTVA", numero: "999" }],
      }),
      FRAGMENTS,
    );
    expect(lu.certitude).toBe(0);
    expect(lu.sources).toEqual([]);
  });

  it("une question sur le dossier n'est pas du conseil : certitude pleine, rien à arbitrer", () => {
    const lu = lireReponseDeConseil(
      '```json\n{"reponse":"Votre crédit de TVA est de 64,600.","conseil":false,"certitude":0.3,"sources":[{"corpus":"CTVA","numero":"9"}],"theme":"x","doute":"y"}\n```',
      FRAGMENTS,
    );
    expect(lu.conseil).toBe(false);
    expect(lu.certitude).toBe(1);
    expect(lu.sources).toEqual([]);
    expect(lu.theme).toBeNull();
    expect(lu.doute).toBeNull();
  });

  it("un texte qui n'est pas l'objet demandé est gardé, et traité avec prudence", () => {
    const lu = lireReponseDeConseil("Le taux normal s'applique.", FRAGMENTS);
    expect(lu.structuree).toBe(false);
    expect(lu.reponse).toBe("Le taux normal s'applique.");
    expect(lu.conseil).toBe(true);
    expect(lu.certitude).toBe(0);
  });

  it("un texte libre sans droit transmis n'est pas du conseil", () => {
    const lu = lireReponseDeConseil("Bonjour.", []);
    expect(lu.conseil).toBe(false);
  });
});

describe("resoudreLesSources", () => {
  it("accepte un numéro sans corpus quand il est sans ambiguïté", () => {
    expect(resoudreLesSources([{ corpus: "", numero: "12" }], FRAGMENTS)).toHaveLength(1);
  });

  it("refuse un numéro sans corpus quand deux fragments le portent", () => {
    const deux = [fragment("CTVA", "9"), fragment("CDPF", "9")];
    expect(resoudreLesSources([{ corpus: "", numero: "9" }], deux)).toEqual([]);
  });

  it("ne rend jamais deux fois le même article", () => {
    expect(
      resoudreLesSources(
        [
          { corpus: "ctva", numero: "9" },
          { corpus: "CTVA", numero: " 9 " },
        ],
        FRAGMENTS,
      ),
    ).toHaveLength(1);
  });
});
