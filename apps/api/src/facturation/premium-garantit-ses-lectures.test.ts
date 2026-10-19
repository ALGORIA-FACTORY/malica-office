/**
 * Premium garantit les lectures de ses sociétés incluses, même s'il n'en
 * occupe qu'une (décidé le 19 octobre 2026). Les nombres viennent de la grille,
 * jamais d'ici. Tout se passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("Premium garantit ses lectures", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

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

  async function societe(db: pg.PoolClient, titulaire: string): Promise<string> {
    const o = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', 'Premium d''essai', 'TN', 'TND') returning id`,
    );
    await db.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [o.rows[0]!.id, titulaire],
    );
    return o.rows[0]!.id;
  }

  const droit = async (db: pg.PoolClient, licence: string) =>
    Number(
      (
        await db.query<{ n: number }>(
          "select lectures_droit as n from facturation.droits_v where licence_id = $1",
          [licence],
        )
      ).rows[0]!.n,
    );

  it("une société, deux, trois : les incluses sont dues, la suivante s'ajoute", async () => {
    await aBlanc(async (db) => {
      const g = await db.query<{ par: number; incluses: number }>(
        `select lectures_par_organisation as par, organisations_incluses as incluses
           from ref.offre_a('premium', current_date)`,
      );
      const { par, incluses } = g.rows[0]!;
      assert.ok(incluses >= 2, "le Premium inclut plusieurs sociétés");

      const titulaire = randomUUID();
      const premiere = await societe(db, titulaire);
      const l = await db.query<{ id: string }>(
        `insert into facturation.licences (titulaire, offre_code, offre_depuis)
         values ($1, 'premium', current_date) returning id`,
        [titulaire],
      );
      const licence = l.rows[0]!.id;
      await db.query(
        "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
        [licence, premiere],
      );
      assert.equal(await droit(db, licence), par * incluses, "une seule société : tout l'inclus");

      for (let n = 2; n <= incluses + 1; n++) {
        const s = await societe(db, titulaire);
        await db.query(
          "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
          [licence, s],
        );
        assert.equal(await droit(db, licence), par * Math.max(n, incluses), `${n} sociétés`);
      }

      const offre = await db.query<{ n: number }>(
        "select lectures_incluses as n from public.mes_offres() where code = 'premium'",
      );
      assert.equal(
        Number(offre.rows[0]!.n),
        par * incluses,
        "la grille affichée dit la même chose",
      );
    });
  });

  it("Basic, Solo et Team ne changent pas : une société incluse", async () => {
    await aBlanc(async (db) => {
      const r = await db.query<{ code: string; incluses: number }>(
        `select code, organisations_incluses as incluses from public.mes_offres()
          where code in ('basic', 'solo', 'team')`,
      );
      assert.equal(r.rows.length, 3);
      for (const o of r.rows) assert.equal(o.incluses, 1, o.code);
    });
  });
});
