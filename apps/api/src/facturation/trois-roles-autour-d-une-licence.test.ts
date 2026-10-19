/**
 * Trois rôles autour d'une licence (décidés le 19 octobre 2026).
 *
 *   - le propriétaire principal, titulaire : seul à toucher l'abonnement, il
 *     n'occupe pas de place ;
 *   - le propriétaire, optionnel : un autre dirigeant, qui OCCUPE une place
 *     payée et ne touche pas l'abonnement ;
 *   - l'utilisateur, collaborateur : il occupe une place.
 *
 * Et le titulaire se transmet, à un propriétaire seulement, en s'inscrivant.
 *
 * Tout se passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Societe {
  tenant: string;
  licence: string;
  principal: string;
}

async function societe(db: pg.PoolClient, offre: "basic" | "team"): Promise<Societe> {
  const principal = randomUUID();
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Trois rôles d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = org.rows[0]!.id;
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, principal],
  );
  const l = await db.query<{ id: string }>(
    `insert into facturation.licences (titulaire, offre_code, offre_depuis)
     values ($1, $2, current_date) returning id`,
    [principal, offre],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [l.rows[0]!.id, tenant],
  );
  return { tenant, licence: l.rows[0]!.id, principal };
}

async function membre(db: pg.PoolClient, tenant: string, role: string): Promise<string> {
  const u = randomUUID();
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, $3)",
    [tenant, u, role],
  );
  return u;
}

/** Endosse `authenticated` sous l'identité donnée ; un refus n'emporte pas la transaction. */
async function sous<T>(db: pg.PoolClient, identite: string, corps: () => Promise<T>): Promise<T> {
  await db.query("savepoint sous_role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [identite]);
  try {
    const r = await corps();
    await db.query("reset role");
    await db.query("release savepoint sous_role");
    return r;
  } catch (erreur) {
    await db.query("rollback to savepoint sous_role");
    await db.query("reset role");
    throw erreur;
  }
}

const places = async (db: pg.PoolClient, licence: string) =>
  Number(
    (
      await db.query<{ n: number }>(
        "select sieges_occupes as n from facturation.places_v where licence_id = $1",
        [licence],
      )
    ).rows[0]!.n,
  );

const code = (attendu: string) => (e: { code?: string }) => e.code === attendu;

describe("trois rôles autour d'une licence", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  async function dansUneTransaction(corps: (db: pg.PoolClient) => Promise<void>): Promise<void> {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      await corps(db);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  it("le propriétaire principal n'occupe pas de place ; un propriétaire en occupe une", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "team");
      assert.equal(await places(db, s.licence), 0, "le titulaire est dans le prix");
      await membre(db, s.tenant, "dirigeant");
      assert.equal(await places(db, s.licence), 1, "un second dirigeant est une place");
      await membre(db, s.tenant, "collaborateur");
      assert.equal(await places(db, s.licence), 2);
      const fonction = await db.query<{ n: number }>(
        "select facturation.places_occupees($1) as n",
        [s.licence],
      );
      assert.equal(fonction.rows[0]!.n, 2, "la vue et la fonction comptent la même chose");
    });
  });

  it("sur un Basic, un second propriétaire n'entre pas : il n'y a pas de place", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "basic");
      await db.query("savepoint avant");
      await assert.rejects(membre(db, s.tenant, "dirigeant"), code("23514"));
      await db.query("rollback to savepoint avant");
    });
  });

  it("seul le propriétaire principal invite, un utilisateur comme un propriétaire", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "team");
      const proprietaire = await membre(db, s.tenant, "dirigeant");

      for (const [appel, args] of [
        ["select public.siege_inviter($1, $2)", [s.tenant, "u@essai.local"]],
        ["select public.proprietaire_inviter($1, $2)", [s.tenant, "p@essai.local"]],
        ["select public.cabinet_inviter($1, $2, 'collaborateur')", [s.tenant, "c@essai.local"]],
      ] as const) {
        await assert.rejects(
          sous(db, proprietaire, () => db.query(appel, [...args])),
          code("42501"),
          `${appel} : un propriétaire ne donne pas de place`,
        );
      }

      const r = await sous(db, s.principal, () =>
        db.query<{ r: { role: string } }>("select public.proprietaire_inviter($1, $2) as r", [
          s.tenant,
          "associe@essai.local",
        ]),
      );
      assert.equal(r.rows[0]!.r.role, "dirigeant");
      const u = await sous(db, s.principal, () =>
        db.query<{ r: { role: string } }>("select public.siege_inviter($1, $2) as r", [
          s.tenant,
          "equipe@essai.local",
        ]),
      );
      assert.equal(u.rows[0]!.r.role, "collaborateur");
    });
  });

  it("un propriétaire ne change pas le forfait ; le principal, si", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "team");
      const proprietaire = await membre(db, s.tenant, "dirigeant");
      await assert.rejects(
        sous(db, proprietaire, () =>
          db.query("select public.forfait_changer('basic', $1, current_date)", [s.tenant]),
        ),
        /forfait_refuse:pas_de_licence/,
      );
    });
  });

  it("le titulaire se transmet à un propriétaire, et la transmission s'inscrit", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "team");
      const proprietaire = await membre(db, s.tenant, "dirigeant");
      const utilisateur = await membre(db, s.tenant, "collaborateur");
      assert.equal(await places(db, s.licence), 2);

      await assert.rejects(
        sous(db, proprietaire, () =>
          db.query("select public.licence_transmettre($1, $2)", [s.tenant, proprietaire]),
        ),
        code("42501"),
        "un propriétaire ne se donne pas la licence",
      );
      await assert.rejects(
        sous(db, s.principal, () =>
          db.query("select public.licence_transmettre($1, $2)", [s.tenant, utilisateur]),
        ),
        code("22023"),
        "on ne transmet pas à un utilisateur",
      );

      await sous(db, s.principal, () =>
        db.query("select public.licence_transmettre($1, $2)", [s.tenant, proprietaire]),
      );

      const l = await db.query<{ titulaire: string }>(
        "select titulaire from facturation.licences where id = $1",
        [s.licence],
      );
      assert.equal(l.rows[0]!.titulaire, proprietaire);
      const t = await db.query<{ de: string; a: string }>(
        "select de, a from facturation.transmissions where licence_id = $1",
        [s.licence],
      );
      assert.deepEqual(t.rows, [{ de: s.principal, a: proprietaire }]);
      assert.equal(await places(db, s.licence), 2, "l'ancien prend la place que le nouveau libère");

      // Le nouveau principal touche l'abonnement ; l'ancien ne le peut plus.
      await assert.rejects(
        sous(db, s.principal, () =>
          db.query("select public.siege_inviter($1, $2)", [s.tenant, "x@essai.local"]),
        ),
        code("42501"),
      );
      await sous(db, proprietaire, () =>
        db.query("select public.siege_inviter($1, $2)", [s.tenant, "y@essai.local"]),
      );
    });
  });

  it("hors transmission, le titulaire ne se réécrit pas, et la transmission ne s'efface pas", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "team");
      const proprietaire = await membre(db, s.tenant, "dirigeant");

      await db.query("savepoint avant");
      await assert.rejects(
        db.query("update facturation.licences set titulaire = $1 where id = $2", [
          proprietaire,
          s.licence,
        ]),
        code("23514"),
      );
      await db.query("rollback to savepoint avant");

      await sous(db, s.principal, () =>
        db.query("select public.licence_transmettre($1, $2)", [s.tenant, proprietaire]),
      );
      await db.query("savepoint efface");
      await assert.rejects(
        db.query("delete from facturation.transmissions where licence_id = $1", [s.licence]),
      );
      await db.query("rollback to savepoint efface");

      await assert.rejects(
        sous(db, proprietaire, () =>
          db.query(
            "insert into facturation.transmissions (licence_id, de, a) values ($1, $2, $3)",
            [s.licence, proprietaire, s.principal],
          ),
        ),
        code("42501"),
        "personne n'écrit une transmission à la main",
      );
    });
  });
});
