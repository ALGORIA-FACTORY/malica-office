/**
 * La fiche sait si le matricule est figé (recette du 11 novembre 2026, 5.1) :
 * la même règle que la porte `cabinet_modifier_dossier`, lue par l'écran pour
 * griser le champ au lieu de laisser la porte refuser toute la fiche.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "./personne-d-essai.ts";
import { refusLisible } from "./refus.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("identite.matriculeFige", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("faux sans pièce, vrai dès la première, refusé hors du mandat", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const [expert, dirigeant, etranger] = [randomUUID(), randomUUID(), randomUUID()];
      await personnesDEssai(db, expert, dirigeant, etranger);
      const org = async (kind: string) =>
        (
          await db.query<{ id: string }>(
            `insert into identity.organizations (kind, name, jurisdiction, currency)
             select $1, 'Essai matricule ' || $1, p.jurisdiction, p.currency
               from ref.jurisdiction_packs p order by p.jurisdiction limit 1
             returning id`,
            [kind],
          )
        ).rows[0]!.id;
      const cabinet = await org("cabinet");
      const pme = await org("pme");
      await db.query(
        `insert into identity.memberships (tenant_id, user_id, role)
         values ($1, $2, 'expert'), ($3, $4, 'dirigeant')`,
        [cabinet, expert, pme, dirigeant],
      );
      await db.query(
        `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
         values ($1, $2, 'actif', date '2026-01-01')`,
        [pme, cabinet],
      );
      const lire = async (qui: string) => {
        await db.query("reset role");
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
        await db.query("savepoint lecture");
        try {
          const r = await executerRpc(db, {
            depot: "identite",
            methode: "matriculeFige",
            args: [cabinet, pme],
          });
          await db.query("release savepoint lecture");
          return r;
        } catch (e) {
          await db.query("rollback to savepoint lecture");
          return refusLisible(e);
        }
      };
      assert.equal(await lire(expert), false);
      await db.query("reset role");
      await db.query(
        `insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key, created_by)
         values ($1, 'entite', 'photo', 'essai/rien', $2, $3)`,
        [pme, `matricule-${randomUUID()}`, dirigeant],
      );
      assert.equal(await lire(expert), true);
      assert.equal(await lire(etranger), "refus.mandat.hors_cabinet");
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
