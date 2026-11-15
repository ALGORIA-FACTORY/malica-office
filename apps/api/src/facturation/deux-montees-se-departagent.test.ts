/**
 * Deux montées d'une même transaction se départagent (recette du 13 novembre
 * 2026 : `la-montee-pendant-l-annee`, test 3, rouge sur une base vécue, vert sur
 * une base neuve).
 *
 * `facturation.annuel_de` lit la montée en vigueur par
 * `order by le desc, created_at desc limit 1`. `created_at` valait `now()`,
 * figé pendant toute la transaction : deux montées du même jour, passées dans
 * la même transaction, portaient le même instant, et la ligne retenue dépendait
 * de l'ordre physique de la table. Un instant par montée : `clock_timestamp()`.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/deux-montees-se-departagent.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { changerDOffre, decor, prix } from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("deux montées d'une même transaction", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("portent deux instants distincts, et la dernière est celle qui est en vigueur", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin isolation level repeatable read");
      const d = await decor(db, "solo");
      const solo = await prix(db, "solo");
      await db.query(
        `insert into facturation.engagements_annuels
           (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
         values ($1, 'solo', $2::date, ($2::date + interval '1 year - 1 day')::date, $3::numeric,
                 2, $3::numeric * 10, $4)`,
        [d.licence, d.mois, solo, d.titulaire],
      );
      assert.ok(await changerDOffre(db, d, "team"));
      assert.ok(await changerDOffre(db, d, "premium"));

      const { rows } = await db.query<{ offre_code: string; instant: string }>(
        `select m.offre_code, m.created_at::text as instant
           from facturation.engagement_montees m
          where m.licence_id = $1
          order by m.created_at, m.offre_code desc`,
        [d.licence],
      );
      assert.equal(rows.length, 2);
      assert.notEqual(
        rows[0]!.instant,
        rows[1]!.instant,
        "un instant par montée, même dans une transaction",
      );
      assert.deepEqual(
        rows.map((r) => r.offre_code),
        ["team", "premium"],
        "dans l'ordre où elles ont été passées",
      );

      const { rows: en } = await db.query<{ o: string }>(
        "select (facturation.annuel_de($1, current_date)).offre_code as o",
        [d.licence],
      );
      assert.equal(en[0]!.o, "premium", "la dernière montée du jour est celle qui compte");
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
