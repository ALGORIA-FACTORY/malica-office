/**
 * Un dossier se désaffecte (staging, 5 novembre 2026) : une affectation se
 * remplaçait, elle ne se retirait pas.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/un-dossier-se-desaffecte.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { collab } from "./depots/collab.ts";

describe("un dossier se désaffecte", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  const actives = async () =>
    (await sousIdentite(s.gens.expert.id, (db) => collab.assignments(db, s.cabinet))).filter(
      (a) => a.active && a.clientTenantId === s.pme,
    );

  before(async () => {
    s = await monterUneSociete(`desaffecter-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("l'expert retire l'affectation : le dossier redevient sans collaborateur, l'historique reste", async () => {
    await sousIdentite(s.gens.expert.id, (db) =>
      collab.assign(db, {
        cabinetTenantId: s.cabinet,
        clientTenantId: s.pme,
        collaboratorId: s.gens.expert.id,
      }),
    );
    assert.equal((await actives()).length, 1);
    await sousIdentite(s.gens.expert.id, (db) =>
      collab.desaffecter(db, { cabinetTenantId: s.cabinet, clientTenantId: s.pme }),
    );
    assert.equal((await actives()).length, 0);
    const toutes = await sousIdentite(s.gens.expert.id, (db) => collab.assignments(db, s.cabinet));
    assert.ok(toutes.some((a) => a.clientTenantId === s.pme && !a.active));
  });

  it("refuse de retirer une affectation qui n'existe pas", async () => {
    await assert.rejects(
      sousIdentite(s.gens.expert.id, (db) =>
        collab.desaffecter(db, { cabinetTenantId: s.cabinet, clientTenantId: s.pme }),
      ),
      /refus\.collab\.aucune_affectation/,
    );
  });

  it("refuse à qui n'est pas du cabinet", async () => {
    await assert.rejects(
      sousIdentite(s.gens.amel.id, (db) =>
        collab.desaffecter(db, { cabinetTenantId: s.cabinet, clientTenantId: s.pme }),
      ),
      /refus\.geste\.non_permis/,
    );
  });
});
