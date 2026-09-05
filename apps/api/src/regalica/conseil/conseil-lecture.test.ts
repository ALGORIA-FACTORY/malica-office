/**
 * La lecture d'une réponse de conseil : ce qu'on croit du modèle, et ce
 * qu'on relit dans ce qu'on lui a montré.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FragmentDeDroit } from "./corpus.ts";
import { lireReponseDeConseil, resoudreLesSources } from "./conseil.ts";

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
    assert.equal(lu.structuree, true);
    assert.equal(lu.conseil, true);
    assert.equal(lu.reponse, "Oui, sous condition.");
    assert.equal(lu.certitude, 0.72);
    assert.deepEqual(
      lu.sources.map((s) => `${s.corpus} ${s.numero}`),
      ["CTVA 9"],
    );
    assert.equal(lu.theme, "Déduction de TVA sur véhicule");
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
    assert.equal(lu.certitude, 0);
    assert.deepEqual(lu.sources, []);
  });

  it("une question sur le dossier n'est pas du conseil : certitude pleine, rien à arbitrer", () => {
    const lu = lireReponseDeConseil(
      '```json\n{"reponse":"Votre crédit de TVA est de 64,600.","conseil":false,"certitude":0.3,"sources":[{"corpus":"CTVA","numero":"9"}],"theme":"x","doute":"y"}\n```',
      FRAGMENTS,
    );
    assert.equal(lu.conseil, false);
    assert.equal(lu.certitude, 1);
    assert.deepEqual(lu.sources, []);
    assert.equal(lu.theme, null);
    assert.equal(lu.doute, null);
  });

  it("un texte qui n'est pas l'objet demandé est gardé, et traité avec prudence", () => {
    const lu = lireReponseDeConseil("Le taux normal s'applique.", FRAGMENTS);
    assert.equal(lu.structuree, false);
    assert.equal(lu.reponse, "Le taux normal s'applique.");
    assert.equal(lu.conseil, true);
    assert.equal(lu.certitude, 0);
  });

  it("un texte libre sans droit transmis n'est pas du conseil", () => {
    const lu = lireReponseDeConseil("Bonjour.", []);
    assert.equal(lu.conseil, false);
  });
});

describe("resoudreLesSources", () => {
  it("accepte un numéro sans corpus quand il est sans ambiguïté", () => {
    assert.equal(resoudreLesSources([{ corpus: "", numero: "12" }], FRAGMENTS).length, 1);
  });

  it("refuse un numéro sans corpus quand deux fragments le portent", () => {
    const deux = [fragment("CTVA", "9"), fragment("CDPF", "9")];
    assert.deepEqual(resoudreLesSources([{ corpus: "", numero: "9" }], deux), []);
  });

  it("ne rend jamais deux fois le même article", () => {
    assert.equal(
      resoudreLesSources(
        [
          { corpus: "ctva", numero: "9" },
          { corpus: "CTVA", numero: " 9 " },
        ],
        FRAGMENTS,
      ).length,
      1,
    );
  });
});
