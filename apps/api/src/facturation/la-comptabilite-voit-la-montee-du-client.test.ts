/**
 * La comptabilité ne « monte » pas vers l'offre que le client a déjà prise à
 * sa charge (recette du 11 novembre 2026, point 1.2 ; migration
 * 20261214120000). Sous l'identité de l'expert, par la vraie porte.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-comptabilite-voit-la-montee-du-client.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import {
  changerDOffre,
  couvreDepuisLeDebutDuMois,
  decor,
  enPersonne,
  uneComptabilite,
} from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("la comptabilité voit la montée du client", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("couvert en Team, monté en Premium : l'état le dit, et monter en Premium est refusé", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const d = await decor(db, "team");
      const c = await uneComptabilite(db, d);
      const acces = await couvreDepuisLeDebutDuMois(db, d, c, "team");
      await changerDOffre(db, d, "premium");

      const vu = await enPersonne(db, c.expert, async () => {
        const { rows } = await db.query<{ acces_offre: string; forfait_offre: string }>(
          `select acces_offre, forfait_offre from public.clients_du_cabinet_etat($1)
            where tenant_id = $2`,
          [c.cabinet, d.tenant],
        );
        return rows[0]!;
      });
      assert.deepEqual(vu, { acces_offre: "team", forfait_offre: "premium" });

      await assert.rejects(
        enPersonne(db, c.expert, () =>
          db.query("select public.acces_changer_offre($1, 'premium')", [acces]),
        ),
        /refus\.abonnement\.deja_l_offre_du_client$/,
      );
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
