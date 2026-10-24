/**
 * Le rattrapage et ses garde-fous, sans base ni fournisseur.
 *
 * Audit de la lecture du 24 octobre 2026 : la chaîne cassait dans ses
 * replis. Cette épreuve tient les règles pures qui les décident — quelle
 * lecture vaut mieux, quel lecteur relit, ce qu'un plan trop long garde, ce
 * que vaut une variable de modèle vide, et le coupe-circuit de PaddleOCR.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { modeleOcr } from "../modeles.ts";

import { ouvrirLeCoupeCircuit, refermerLeCoupeCircuit, secondLecteurDisponible } from "./paddle.ts";
import { autreLecteur, qualiteDeLecture } from "./read-flow.ts";
import { planBorne } from "./vision.ts";

const incoherent = { code: "ARITHMETIQUE_INCOHERENTE" };

describe("la qualité d'une lecture se prouve", () => {
  it("complète et cohérente : rien à rattraper", () => {
    assert.equal(qualiteDeLecture({ contract: "extract.v1", flags: [] }), 3);
  });

  it("complète mais fausse : elle se rattrape, et une cohérente la bat", () => {
    const fausse = qualiteDeLecture({ contract: "extract.v1", flags: [incoherent] });
    const juste = qualiteDeLecture({ contract: "extract.v1", flags: [] });
    assert.ok(fausse < 3);
    assert.ok(juste > fausse);
  });

  it("partielle mais cohérente bat partielle et fausse, et perd contre complète", () => {
    const partielle = qualiteDeLecture({ contract: "extract.v1.partiel", flags: [] });
    const partielleFausse = qualiteDeLecture({
      contract: "extract.v1.partiel",
      flags: [incoherent],
    });
    const completeFausse = qualiteDeLecture({ contract: "extract.v1", flags: [incoherent] });
    assert.ok(partielle > partielleFausse);
    assert.ok(completeFausse > partielle);
  });
});

describe("le rattrapage relit avec un AUTRE lecteur", () => {
  it("la couche de texte d'un PDF → ses images", () => {
    assert.deepEqual(autreLecteur({ lecteur: "pdf-text", paddleTente: false }, true), {
      sansCoucheTexte: true,
    });
  });

  it("PaddleOCR → le modèle de vision", () => {
    assert.deepEqual(autreLecteur({ lecteur: "paddle", paddleTente: true }, true), {
      sansPaddle: true,
    });
  });

  it("le modèle de vision → PaddleOCR, s'il est là et pas encore essayé", () => {
    assert.deepEqual(autreLecteur({ lecteur: "vision", paddleTente: false }, true), {});
  });

  it("PaddleOCR déjà essayé, ou absent : pas de second appel pour la même réponse", () => {
    assert.equal(autreLecteur({ lecteur: "vision", paddleTente: true }, true), null);
    assert.equal(autreLecteur({ lecteur: "vision", paddleTente: false }, false), null);
    assert.equal(autreLecteur({ lecteur: "fourni", paddleTente: false }, true), null);
  });
});

describe("un plan trop long garde ses deux bouts", () => {
  const ligne = (i: number) => `1.${i}\t0.100,0.100,0.200,0.120\t${"x".repeat(40)}`;

  it("un plan court passe tel quel", () => {
    const lignes = [ligne(0), ligne(1)];
    assert.equal(planBorne(lignes), lignes.join("\n"));
  });

  it("un plan long garde l'en-tête ET les totaux, et dit ce qui manque", () => {
    const lignes = Array.from({ length: 5000 }, (_, i) => ligne(i));
    lignes.push("1.5000\t0.700,0.950,0.900,0.970\tTOTAL TTC 5 650,000");
    const borne = planBorne(lignes);
    assert.ok(borne.startsWith(ligne(0)), "l'en-tête reste");
    assert.ok(borne.endsWith("TOTAL TTC 5 650,000"), "le total de la fin reste");
    assert.match(borne, /\(\d+ mots du milieu omis\)/);
    assert.ok(borne.length <= 60_000 + 40, "le plafond tient");
    for (const l of borne.split("\n")) {
      assert.ok(l.startsWith("1.") || l.startsWith("("), "aucune ligne coupée en deux");
    }
  });
});

describe("le modèle de vision : une variable vide vaut une variable absente", () => {
  const avant = process.env["QWEN_OCR_MODEL"];
  afterEach(() => {
    if (avant === undefined) delete process.env["QWEN_OCR_MODEL"];
    else process.env["QWEN_OCR_MODEL"] = avant;
  });

  it("vide ou blanche : le modèle par défaut", () => {
    process.env["QWEN_OCR_MODEL"] = "";
    assert.notEqual(modeleOcr(), "");
    process.env["QWEN_OCR_MODEL"] = "   ";
    assert.notEqual(modeleOcr().trim(), "");
  });

  it("posée : elle l'emporte", () => {
    process.env["QWEN_OCR_MODEL"] = "qwen-essai";
    assert.equal(modeleOcr(), "qwen-essai");
  });
});

describe("PaddleOCR tombé est écarté un moment, puis réessayé", () => {
  const avant = process.env["OCR_URL"];
  afterEach(() => {
    refermerLeCoupeCircuit();
    if (avant === undefined) delete process.env["OCR_URL"];
    else process.env["OCR_URL"] = avant;
  });

  it("coupe-circuit ouvert : il n'est plus proposé", () => {
    process.env["OCR_URL"] = "http://ocr.invalid";
    assert.equal(secondLecteurDisponible(), true);
    ouvrirLeCoupeCircuit();
    assert.equal(secondLecteurDisponible(), false);
  });

  it("le délai passé, il revient de lui-même", () => {
    process.env["OCR_URL"] = "http://ocr.invalid";
    ouvrirLeCoupeCircuit(Date.now() - 10 * 60_000);
    assert.equal(secondLecteurDisponible(), true);
  });
});
