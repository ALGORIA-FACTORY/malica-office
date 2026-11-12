/**
 * Les places, vues du dirigeant (recette du 11 novembre 2026, point 3.9).
 *
 *  - La place donnée par la comptabilité qui paie se voit, en attente, dans
 *    Réglages › Utilisateurs du dirigeant.
 *  - Après la transmission du rôle de propriétaire principal, l'ancienne
 *    titulaire lit encore ses places (occupées / incluses) et l'offre : ni
 *    « — / — », ni une offre plus basse que la vraie.
 *
 * Par les vraies portes, sous l'identité de chacun.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "../personne-d-essai.ts";

import {
  couvreDepuisLeDebutDuMois,
  decor,
  enPersonne,
  uneComptabilite,
} from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function aBlanc(corps: (db: pg.PoolClient) => Promise<void>) {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

describe("les places se voient du dirigeant", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("la place donnée par la comptabilité est en attente chez le dirigeant", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team");
      const c = await uneComptabilite(db, d);
      await couvreDepuisLeDebutDuMois(db, d, c, "team");
      await enPersonne(db, c.expert, () =>
        db.query("select public.cabinet_place_pour_le_client($1, $2, $3)", [
          c.cabinet,
          d.tenant,
          "nouvelle.recrue@essai.local",
        ]),
      );
      const vues = await enPersonne(db, d.titulaire, async () => {
        const { rows } = await db.query<{ email: string }>(
          `select email from invitations_v
            where tenant_id = $1 and accepted_at is null and revoked_at is null`,
          [d.tenant],
        );
        return rows.map((r) => r.email);
      });
      assert.deepEqual(vues, ["nouvelle.recrue@essai.local"]);
    });
  });

  it("après la transmission, l'ancienne titulaire lit encore ses places et son offre", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team");
      const nouveau = randomUUID();
      await personnesDEssai(db, nouveau);
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
        [d.tenant, nouveau],
      );
      await enPersonne(db, d.titulaire, () =>
        db.query("select public.licence_transmettre($1, $2)", [d.tenant, nouveau]),
      );
      const ligne = await enPersonne(db, d.titulaire, async () => {
        const { rows } = await db.query<{
          offre: string;
          sieges_occupes: number | null;
          sieges_inclus: number | null;
          titulaire: boolean;
        }>("select offre, sieges_occupes, sieges_inclus, titulaire from public.mon_forfait($1)", [
          d.tenant,
        ]);
        return rows[0]!;
      });
      assert.equal(ligne.titulaire, false);
      assert.equal(ligne.offre, "team");
      assert.notEqual(ligne.sieges_inclus, null, "pas de « — / — »");
      assert.notEqual(ligne.sieges_occupes, null);
    });
  });
});
