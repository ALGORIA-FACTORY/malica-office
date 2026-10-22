/**
 * ANO-025 — Un émetteur mal lu ne s'affiche plus avec la coche « source ».
 *
 * Le contrôle `confiance_lecture` nommait déjà, dans ses preuves, les champs
 * lus sous le seuil de réserve ; l'écran ne le recevait pas. `champsAVerifier`
 * rend ces champs tels que le dernier jugement de la dernière lecture les a
 * posés — sans rien recalculer.
 *
 *   node --experimental-strip-types --test src/scan/champs-a-verifier.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Requete } from "../db.ts";

import { champsAVerifier } from "./proposition.ts";

/** Une base qui rend une seule ligne d'analyse, ou aucune. */
const base = (controles: unknown): Requete =>
  ({
    query: async () => ({ rows: controles === undefined ? [] : [{ controles }] }),
  }) as unknown as Requete;

const confiance = (statut: string, champs: unknown) => ({
  code: "confiance_lecture",
  statut,
  motif: "…",
  preuves: { champs },
});

describe("ANO-025 — les champs à vérifier", () => {
  it("une réserve de lecture nomme ses champs", async () => {
    const champs = await champsAVerifier(
      base([{ code: "date_plausible", statut: "conforme" }, confiance("reserve", ["issuer"])]),
      "p",
    );
    assert.deepEqual(champs, ["issuer"]);
  });

  it("une anomalie de lecture les nomme aussi", async () => {
    const champs = await champsAVerifier(
      base([confiance("anomalie", ["issuer", "totals.ttc"])]),
      "p",
    );
    assert.deepEqual(champs, ["issuer", "totals.ttc"]);
  });

  it("une anomalie rend aussi les champs seulement en réserve (`aRelire`)", async () => {
    const champs = await champsAVerifier(
      base([
        {
          code: "confiance_lecture",
          statut: "anomalie",
          preuves: { champs: ["totals.ttc"], aRelire: ["totals.ttc", "issuer"] },
        },
      ]),
      "p",
    );
    assert.deepEqual(champs, ["totals.ttc", "issuer"]);
  });

  it("une lecture conforme ne signale rien", async () => {
    assert.deepEqual(await champsAVerifier(base([confiance("conforme", [])]), "p"), []);
  });

  it("sans jugement de la dernière lecture, rien n'est affirmé", async () => {
    assert.deepEqual(await champsAVerifier(base(undefined), "p"), []);
  });

  it("des preuves mal formées ne font rien inventer", async () => {
    assert.deepEqual(await champsAVerifier(base([confiance("reserve", "issuer")]), "p"), []);
    assert.deepEqual(await champsAVerifier(base([confiance("reserve", [42, "issuer"])]), "p"), [
      "issuer",
    ]);
    assert.deepEqual(await champsAVerifier(base("pas une liste"), "p"), []);
  });
});
