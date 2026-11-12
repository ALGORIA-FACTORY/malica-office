/**
 * Le PV dit combien de pièces ont été retournées dans le mois, d'après le
 * journal d'audit (recette du 11 novembre 2026, 5.4) : deux pièces
 * retournées puis renvoyées dans la journée n'étaient plus « retournées » au
 * moment du PV, et Malica écrivait « aucune pièce n'a été retournée ».
 *
 * Sur une vraie base, sous `authenticated` : l'expert du cabinet mandaté lit
 * le compte de son dossier ; un étranger lit 0.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "./personne-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("supervision.piecesRetourneesEntre", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("compte les pièces retournées dans la période, une fois chacune, pour le seul mandat", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const [expert, etranger] = [randomUUID(), randomUUID()];
      await personnesDEssai(db, expert, etranger);
      const org = async (kind: string) =>
        (
          await db.query<{ id: string }>(
            `insert into identity.organizations (kind, name, jurisdiction, currency)
             select $1, 'Essai PV ' || $1, p.jurisdiction, p.currency
               from ref.jurisdiction_packs p order by p.jurisdiction limit 1
             returning id`,
            [kind],
          )
        ).rows[0]!.id;
      const cabinet = await org("cabinet");
      const pme = await org("pme");
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')",
        [cabinet, expert],
      );
      await db.query(
        `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
         values ($1, $2, 'actif', date '2026-01-01')`,
        [pme, cabinet],
      );
      const [a, b] = [randomUUID(), randomUUID()];
      // A retournée deux fois le 11, B le 11, et A encore en octobre : 2 pièces en novembre.
      for (const [piece, at] of [
        [a, "2026-11-11T09:00:00Z"],
        [a, "2026-11-11T15:00:00Z"],
        [b, "2026-11-11T10:00:00Z"],
        [a, "2026-10-20T10:00:00Z"],
      ] as const) {
        await db.query(
          `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, at)
           values ($1, $2, 'piece.retournee', 'capture', 'pieces', $3, $4::timestamptz)`,
          [pme, expert, piece, at],
        );
      }
      const lire = async (qui: string) => {
        await db.query("reset role");
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
        return executerRpc(db, {
          depot: "supervision",
          methode: "piecesRetourneesEntre",
          args: [pme, "2026-11-01", "2026-11-11"],
        });
      };
      assert.equal(await lire(expert), 2);
      assert.equal(await lire(etranger), 0);
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
