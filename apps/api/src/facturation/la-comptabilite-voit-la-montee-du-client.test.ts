/**
 * La comptabilité voit que le client est monté à sa charge, et peut prendre en charge
 * l'offre qu'il a prise (recette du 11 novembre 2026, point 1.2 ; migration
 * 20261218120000). Sous l'identité de l'expert, par la vraie porte.
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

  it("couvert en Team, monté en Premium : l'état le dit, et la comptabilité peut la prendre en charge", async () => {
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

      const r = await enPersonne(db, c.expert, async () => {
        const { rows } = await db.query<{ r: { effet: string } }>(
          "select public.acces_changer_offre($1, 'premium') as r",
          [acces],
        );
        return rows[0]!.r;
      });
      assert.equal(r.effet, "immediat", "la prise en charge est acceptée par la porte (B7)");
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
