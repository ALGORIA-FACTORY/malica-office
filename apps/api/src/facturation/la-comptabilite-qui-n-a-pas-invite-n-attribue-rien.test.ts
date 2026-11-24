/**
 * La comptabilité d'une société inscrite seule n'a aucun droit sur son abonnement
 * (décision du 23 novembre 2026 ; CGV, art. 4 et 8 — 20261231250000).
 *
 * Seule la comptabilité qui a invité son client dans Malica lui attribue un abonnement ou le
 * fait monter. Une société venue seule garde son abonnement : sa comptabilité tient ses
 * livres, elle ne paie ni ne choisit à sa place. La page Clients le sait, pour ne pas
 * proposer ce qui serait refusé.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-comptabilite-qui-n-a-pas-invite-n-attribue-rien.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { decor, enPersonne, uneComptabilite, type Decor } from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function aBlanc<T>(corps: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    return await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

async function inviteeParNous(db: pg.PoolClient, d: Decor, cabinet: string, expert: string) {
  return enPersonne(db, expert, async () => {
    const { rows } = await db.query<{ invitee_par_nous: boolean }>(
      "select invitee_par_nous from public.clients_du_cabinet_etat($1) where tenant_id = $2",
      [cabinet, d.tenant],
    );
    return rows[0]?.invitee_par_nous;
  });
}

describe("la comptabilité qui n'a pas invité n'attribue rien", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("société venue seule : la comptabilité ne peut pas lui attribuer d'abonnement, et la page le sait", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "basic");
      const c = await uneComptabilite(db, d, { invitee: false });
      assert.equal(await inviteeParNous(db, d, c.cabinet, c.expert), false);
      await assert.rejects(
        enPersonne(db, c.expert, () =>
          db.query("select public.acces_proposer($1, $2, 'team')", [c.cabinet, d.tenant]),
        ),
        /refus\.abonnement\.societe_inscrite_seule/,
      );
    });
  });

  it("société invitée par sa comptabilité : elle peut lui attribuer un abonnement", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "basic");
      const c = await uneComptabilite(db, d);
      assert.equal(await inviteeParNous(db, d, c.cabinet, c.expert), true);
      const id = await enPersonne(db, c.expert, async () => {
        const { rows } = await db.query<{ id: string }>(
          "select public.acces_proposer($1, $2, 'team') as id",
          [c.cabinet, d.tenant],
        );
        return rows[0]!.id;
      });
      assert.ok(id);
    });
  });

  it("un abonnement déjà pris en charge d'une société venue seule : la comptabilité ne le fait plus monter", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "basic");
      const c = await uneComptabilite(db, d, { invitee: false });
      // Pris en charge avant la règle (une ligne d'avant le 24 novembre 2026).
      const { rows } = await db.query<{ id: string }>(
        `insert into facturation.acces
           (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
            propose_le, propose_par, repondu_le, repondu_par, effet_du)
         select $1, $2, 'cabinet', $3, 'solo', o.effective_from, 'actif', $4::date, $5,
                $4::date, $6, $4::date
           from ref.offre_a('solo', $4::date) o
         returning id`,
        [d.tenant, d.licence, c.cabinet, d.mois, c.expert, d.titulaire],
      );
      await assert.rejects(
        enPersonne(db, c.expert, () =>
          db.query("select public.acces_changer_offre($1, 'premium')", [rows[0]!.id]),
        ),
        /refus\.abonnement\.societe_inscrite_seule/,
      );
    });
  });
});
