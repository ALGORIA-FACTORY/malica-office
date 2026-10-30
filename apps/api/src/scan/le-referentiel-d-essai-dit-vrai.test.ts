/**
 * La copie du référentiel dont se sert la mesure des propositions dit la même
 * chose que le pack en base.
 *
 * `referentiel-d-essai.ts` recopie le pack tunisien pour que la mesure tourne
 * sans base. Une copie qui dérive mesurerait une chaîne qui n'existe pas :
 * cette épreuve relit le pack sous l'identité d'un vrai compte (politiques de
 * lecture comprises), au 1er octobre 2026, et compare.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { creerCompte } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { referentiel } from "../depots/referentiel.ts";

import { lireParametres } from "./analyse.ts";
import {
  DROITS_D_ESSAI,
  EXPOSANTS_D_ESSAI,
  IMPUTATIONS_D_ESSAI,
  MENTIONS_D_ESSAI,
  PARAMETRES_D_ESSAI,
  TAUX_D_ESSAI,
  TYPES_D_ESSAI,
} from "./referentiel-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);
const JOUR = "2026-10-01";

describe("le référentiel d'essai", { skip: !BASE_CONFIGUREE }, () => {
  after(() => fermerLePool());

  it("vaut le pack TN en vigueur : taux, imputations, droits, paramètres, mentions, types", async () => {
    const u = await creerCompte(`ref-essai-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select id from ref.jurisdiction_packs
          where jurisdiction = 'TN' and effective_from <= $1::date
          order by effective_from desc limit 1`,
        [JOUR],
      );
      const pack = rows[0]!.id;

      const taux = await referentiel.taxRates(db, pack, "TN");
      const cle = (t: { code: string; rate: string }) => `${t.code}=${Number(t.rate)}`;
      assert.deepEqual(taux.map(cle).sort(), TAUX_D_ESSAI.map(cle).sort(), "taux");

      const imputations = await referentiel.accountMappings(db, pack);
      const imp = (m: (typeof imputations)[number]) =>
        [
          m.documentKind,
          m.taxCode,
          m.mainAccount,
          m.vatAccount,
          m.counterpartyAccount,
          m.journalCode,
        ].join("|");
      assert.deepEqual(
        imputations
          .filter((m) => m.documentKind.startsWith("facture_"))
          .map(imp)
          .sort(),
        IMPUTATIONS_D_ESSAI.map(imp).sort(),
        "imputations",
      );

      const droits = await referentiel.fiscalCharges(db, pack, "fr", JOUR);
      const dr = (d: (typeof droits)[number]) =>
        [d.code, d.documentKind, d.accountCode, d.fixedAmount].join("|");
      assert.deepEqual(droits.map(dr).sort(), DROITS_D_ESSAI.map(dr).sort(), "droits");

      const p = await lireParametres(db, pack, JOUR);
      assert.deepEqual(p, PARAMETRES_D_ESSAI, "paramètres");

      const { rows: mentions } = await db.query<{ code: string }>(
        `select code from ref.mentions where pack_version_id = $1 and mandatory order by code`,
        [pack],
      );
      assert.deepEqual(
        mentions.map((m) => m.code),
        MENTIONS_D_ESSAI.map((m) => m.code).sort(),
        "mentions",
      );

      const { rows: devises } = await db.query<{ code: string; exposant: number }>(
        `select code, exposant from ref.devises order by code`,
      );
      assert.deepEqual(
        Object.fromEntries(devises.map((d) => [d.code, d.exposant])),
        Object.fromEntries(Object.entries(EXPOSANTS_D_ESSAI).sort()),
        "exposants des devises",
      );

      const { rows: types } = await db.query<{ code: string }>(
        `select code from ref.document_types where porte_ecriture order by code`,
      );
      assert.deepEqual(
        types.map((t) => t.code),
        TYPES_D_ESSAI.map((t) => t.code).sort(),
        "types qui portent une écriture",
      );
    });
  });
});
