/**
 * L'outil `calculer` : le moteur du Socle calcule, et le modèle n'y fait entrer
 * aucun nombre à lui. Pur : aucune base, aucun réseau.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppelApi } from "../appel-local.ts";
import { executerOutil, type ContexteDesOutils } from "./outils.ts";

const ctx = (admis: string[]): ContexteDesOutils => ({
  api: {
    rpc: async () => {
      throw new Error("un calcul ne lit rien");
    },
    contenu: async () => {
      throw new Error("un calcul ne lit rien");
    },
  } satisfies AppelApi,
  tenantId: "11111111-1111-4111-8111-111111111111",
  locale: "fr",
  organisation: { jurisdiction: "TN", currency: "TND" },
  aujourdhui: "2026-11-11",
  conseil: async () => {
    throw new Error("un calcul ne consulte pas le droit");
  },
  idProposition: () => "p",
  nombresAdmis: () => new Set(admis),
});

describe("l'outil calculer", () => {
  it("rend le résultat exact comme une source, sur les nombres de la personne", async () => {
    const r = await executerOutil(ctx(["17", "2450"]), "calculer", {
      expression: "2450 * 17 / 100",
    });
    assert.ok(r.ok);
    assert.equal(r.sources.length, 1);
    assert.equal(r.sources[0]!.genre, "calcul");
    assert.match(r.sources[0]!.texte, /Résultat exact : 416,5/);
  });

  it("refuse un nombre que ni la personne ni un outil n'a donné", async () => {
    // Un taux sorti de la mémoire du modèle ne ressort pas « sourcé » par le calcul.
    const r = await executerOutil(ctx(["1200"]), "calculer", { expression: "1200 * 19 / 100" });
    assert.ok(!r.ok);
    assert.match(r.erreur, /emploie 19/);
    const { nombresAdmis: _, ...nu } = ctx([]);
    const sans = await executerOutil(nu, "calculer", { expression: "2 + 2" });
    assert.ok(!sans.ok, "sans nombres admis, rien n'entre");
  });

  it("dit qu'une opération est illisible ou impossible, sans lever", async () => {
    for (const expression of ["", "A2*(1+B2)", "process.exit(1)", "2 +"]) {
      const r = await executerOutil(ctx([]), "calculer", { expression });
      assert.ok(!r.ok && /illisible/.test(r.erreur), expression);
    }
    const r = await executerOutil(ctx(["5", "2"]), "calculer", { expression: "5 / (2 - 2)" });
    assert.ok(!r.ok && /zéro/.test(r.erreur));
  });
});
