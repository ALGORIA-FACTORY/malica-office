/**
 * Le jeu synthétique écrit ses factures et ses écritures attendues avec le
 * référentiel du pack : l'instantané relevé en base (`referentiel-d-essai.json`,
 * vérifié par `le-referentiel-d-essai-dit-vrai.test.ts`) et, pour ce que cet
 * instantané ne porte pas, `outils/jeu-synthetique/referentiel-complementaire.json`.
 *
 * Cette épreuve relit ce complément en base, sous l'identité d'un vrai compte :
 * le taux, l'assiette et le caractère taxable du FODEC (`ref.fiscal_charges`),
 * le compte de la catégorie d'immobilisation (`ref.immo_categories`). Au premier
 * écart, elle échoue — et les écritures attendues du jeu sont à recomposer
 * (`node --experimental-strip-types outils/jeu-synthetique/composer.mjs`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import { creerCompte } from "../../auth.ts";
import { fermerLePool, sousIdentite } from "../../db.ts";
import { RELEVE_D_ESSAI } from "../../scan/referentiel-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

const COMPLEMENT = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../outils/jeu-synthetique/referentiel-complementaire.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  fodec: { code: string; taux: string; assiette: string; entreDansLaBaseDeLaTva: boolean };
  immobilisation: { categorie: string; compte: string };
};

describe("le complément de référentiel du jeu synthétique", { skip: !BASE_CONFIGUREE }, () => {
  after(() => fermerLePool());

  it("vaut le pack en base", async () => {
    const u = await creerCompte(`jeu-synth-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    const lu = await sousIdentite(u.id, async (db) => {
      const pack = `(select id from ref.jurisdiction_packs
                      where jurisdiction = $1 and effective_from <= $2::date
                      order by effective_from desc limit 1)`;
      const { rows: fodec } = await db.query<{ rate: string; basis: string; taxable: boolean }>(
        `select distinct rate::text as rate, basis, taxable from ref.fiscal_charges
          where pack_version_id = ${pack} and code = $3`,
        [RELEVE_D_ESSAI.juridiction, RELEVE_D_ESSAI.jour, COMPLEMENT.fodec.code],
      );
      const { rows: immo } = await db.query<{ account_immo: string }>(
        `select account_immo from ref.immo_categories
          where pack_version_id = ${pack} and code = $3`,
        [RELEVE_D_ESSAI.juridiction, RELEVE_D_ESSAI.jour, COMPLEMENT.immobilisation.categorie],
      );
      return { fodec, immo };
    });
    assert.deepEqual(lu.fodec, [
      {
        rate: COMPLEMENT.fodec.taux,
        basis: COMPLEMENT.fodec.assiette,
        taxable: COMPLEMENT.fodec.entreDansLaBaseDeLaTva,
      },
    ]);
    assert.deepEqual(lu.immo, [{ account_immo: COMPLEMENT.immobilisation.compte }]);
  });
});
