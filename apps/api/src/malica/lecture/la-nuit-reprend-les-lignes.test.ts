/**
 * La nuit reprend les lignes à vérifier (décision du dirigeant, 5 novembre 2026).
 *
 * Le jour, les lignes d'articles qu'aucune somme ne prouve se montrent « lu, non vérifié »
 * (statut `signale`, ou une désignation `incertaine`). La première lecture inscrit alors une
 * relecture de nuit (`consigne.lignes`), avec l'autre lecteur ; la relecture n'est retenue,
 * à qualité égale, que si le moteur PROUVE ses lignes. L'IA ne rend jamais de verdict.
 *
 *   node --experimental-strip-types --test src/malica/lecture/la-nuit-reprend-les-lignes.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SortieDuSudoku } from "@malica/sudoku";

import { relectureRetenue } from "./read-flow.ts";
import { etatDesLignes } from "./sudoku.ts";

type Lignes = NonNullable<SortieDuSudoku["lignes"]>;
type Ligne = Lignes["instances"][number];

const ligne = (statutDesignation?: "incertain"): Ligne =>
  ({
    designation: {
      valeur: "Clavier",
      refs: [{ page: 1, ordinal: 1 }],
      ...(statutDesignation ? { statut: statutDesignation } : {}),
    },
    quantite: { valeur: "1000", refs: [{ page: 1, ordinal: 2 }] },
    prix: { valeur: "5000", refs: [{ page: 1, ordinal: 3 }] },
    remise: null,
    montant: { valeur: "5000", refs: [{ page: 1, ordinal: 4 }] },
    taux: null,
  }) as unknown as Ligne;

const sortie = (lignes: Partial<Lignes> | undefined): SortieDuSudoku =>
  ({
    issue: "prouvee",
    champs: {},
    ...(lignes
      ? { lignes: { statut: "prouve", instances: [], taux_par_base: "verifiee", ...lignes } }
      : {}),
  }) as unknown as SortieDuSudoku;

describe("l'état des lignes d'une lecture", () => {
  it("prouvées : la somme les prouve, chaque désignation est sûre", () => {
    assert.equal(etatDesLignes(sortie({ instances: [ligne()] })), "prouvees");
  });

  it("à vérifier : lues sans preuve", () => {
    assert.equal(etatDesLignes(sortie({ statut: "signale", instances: [ligne()] })), "a_verifier");
  });

  it("à vérifier : prouvées, mais une désignation incertaine", () => {
    assert.equal(etatDesLignes(sortie({ instances: [ligne(), ligne("incertain")] })), "a_verifier");
  });

  it("sans : aucune ligne lue, rien à reprendre", () => {
    assert.equal(etatDesLignes(sortie(undefined)), "sans");
    assert.equal(etatDesLignes(sortie({ statut: "signale", instances: [] })), "sans");
  });
});

describe("la relecture de nuit retenue", () => {
  it("strictement meilleure : retenue, comme avant", () => {
    assert.equal(relectureRetenue(1, 3, false), true);
  });

  it("à qualité égale : retenue seulement si ses lignes sont prouvées", () => {
    assert.equal(relectureRetenue(3, 3, true), true);
    assert.equal(relectureRetenue(3, 3, false), false);
  });

  it("moins bonne : jamais retenue, quoi qu'en disent ses lignes", () => {
    assert.equal(relectureRetenue(3, 2, true), false);
  });
});
