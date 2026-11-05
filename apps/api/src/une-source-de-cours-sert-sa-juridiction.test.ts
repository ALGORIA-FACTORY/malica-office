/**
 * Une source de cours sert sa juridiction (staging, 5 novembre 2026) : la
 * règle de change d'un dossier tunisien proposait la BCEAO.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-source-de-cours-sert-sa-juridiction.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { optionsDeLaRegleDeChange } from "./depots/referentiel.ts";

describe("une source de cours sert sa juridiction", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`change-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("offre la BCT à un dossier tunisien, jamais la BCEAO", async () => {
    const options = await sousIdentite(s.gens.amel.id, (db) =>
      optionsDeLaRegleDeChange(db, "fr", s.pack),
    );
    // D'autres épreuves posent leurs propres sources tunisiennes : on ne
    // compte pas, on vérifie ce que la juridiction sert et ce qu'elle ne sert pas.
    const codes = options.get("change.source")?.map((o) => o.code) ?? [];
    assert.ok(codes.includes("BCT"));
    assert.ok(!codes.includes("BCEAO"));
  });

  it("refuse d'arrêter la BCEAO pour la Tunisie", async () => {
    await assert.rejects(
      s.admin.query(
        `insert into parametrage.regles_de_change
           (tenant_id, portee, portee_id, pack_version_id, code, valeur, valid_from)
         values ($1, 'dossier', $1, $2, 'change.source', 'BCEAO', '2026-01-01')`,
        [s.pme, s.pack],
      ),
      /refus\.change\.source_hors_juridiction/,
    );
  });
});
