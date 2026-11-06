/**
 * Une migration ne s'applique pas en retard (`ordre-des-migrations.mjs`).
 *
 *   node --test db/ordre-des-migrations.test.mjs        (dans `npm test`)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { migrationsEnRetard } from "./ordre-des-migrations.mjs";

describe("une migration ne s'applique pas en retard", () => {
  it("une base neuve n'a rien en retard", () => {
    assert.deepEqual(migrationsEnRetard(["2_b.sql", "1_a.sql"], []), []);
  });

  it("des fichiers après le dernier appliqué ne sont pas en retard", () => {
    assert.deepEqual(migrationsEnRetard(["1_a.sql", "2_b.sql", "3_c.sql"], ["1_a.sql"]), []);
  });

  it("le cas du 6 novembre 2026 : la branche arrive après main, avec des noms plus anciens", () => {
    const main = ["20261130230000_la_relecture_de_nuit_lit_le_jour_du_cabinet.sql"];
    const branche = "20261127300000_la_relecture_de_nuit_se_lit_au_jour_du_dossier.sql";
    assert.deepEqual(migrationsEnRetard([branche, ...main], main), [branche]);
  });

  it("un fichier déjà appliqué n'est jamais en retard, quel que soit son rang", () => {
    assert.deepEqual(migrationsEnRetard(["1_a.sql", "2_b.sql"], ["1_a.sql", "2_b.sql"]), []);
  });
});
