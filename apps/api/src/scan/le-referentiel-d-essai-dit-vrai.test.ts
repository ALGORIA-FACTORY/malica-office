/**
 * L'instantané du référentiel dont se servent les épreuves pures dit la même
 * chose que le pack en base.
 *
 * `referentiel-d-essai.json` est relevé d'une base migrée. Cette épreuve rejoue
 * le MÊME relevé (`releverLeReferentiel`) sous l'identité d'un vrai compte —
 * politiques de lecture comprises — et refuse tout écart. Une migration qui
 * change le pack fait échouer l'épreuve tant que l'instantané n'est pas relevé
 * de nouveau (`outils/relever-le-referentiel-d-essai.mjs`).
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { creerCompte } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";

import { RELEVE_D_ESSAI } from "./referentiel-d-essai.ts";
import { releverLeReferentiel } from "./releve-du-referentiel.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le référentiel d'essai", { skip: !BASE_CONFIGUREE }, () => {
  after(() => fermerLePool());

  it("vaut le pack en base, relevé de la même façon", async () => {
    const u = await creerCompte(`ref-essai-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    const releve = await sousIdentite(u.id, (db) =>
      releverLeReferentiel(db, RELEVE_D_ESSAI.juridiction),
    );
    assert.deepEqual(JSON.parse(JSON.stringify(releve)), RELEVE_D_ESSAI);
  });
});
