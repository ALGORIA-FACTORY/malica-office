/**
 * La tour publie la grille, et la porte refuse les trous.
 *
 * Le point de départ est la grille EN VIGUEUR, lue dans la base : la tour la
 * relit, on y fait une retouche, et on regarde ce que la porte en dit. Aucun
 * prix n'est écrit ici. Tout se passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

type Ligne = Record<string, unknown> & { code: string; rang: number };
interface Grille {
  effective_from: string;
  offres: Ligne[];
  recharges: Ligne[];
}

describe("la tour publie la grille", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  async function enTour(corps: (db: pg.PoolClient) => Promise<void>) {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const operateur = randomUUID();
      await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [operateur]);
      await corps(db);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  const enVigueur = async (db: pg.PoolClient): Promise<Grille> =>
    (await db.query<{ g: Grille }>("select plateforme.grille_en_vigueur() as g")).rows[0]!.g;

  const demain = async (db: pg.PoolClient) =>
    (await db.query<{ d: string }>("select (current_date + 1)::text as d")).rows[0]!.d;

  const trous = async (db: pg.PoolClient, date: string, g: Grille) =>
    (
      await db.query<{ code: string }>("select code from plateforme.grille_trous($1, $2, $3)", [
        date,
        JSON.stringify(g.offres),
        JSON.stringify(g.recharges),
      ])
    ).rows.map((r) => r.code);

  const offre = (g: Grille, code: string) => g.offres.find((o) => o.code === code)!;

  it("la grille en vigueur n'a aucun trou", async () => {
    await enTour(async (db) => {
      const g = await enVigueur(db);
      assert.equal(g.offres.length, 4);
      assert.equal(g.recharges.length, 4);
      assert.deepEqual(await trous(db, await demain(db), g), []);
    });
  });

  it("une date passée, une offre qui disparaît, un prix qui ne monte pas : refusés", async () => {
    await enTour(async (db) => {
      const g = await enVigueur(db);
      assert.ok((await trous(db, g.effective_from, g)).includes("date_passee"));

      const sansTeam = { ...g, offres: g.offres.filter((o) => o.code !== "team") };
      assert.ok((await trous(db, await demain(db), sansTeam)).includes("offre_manquante"));

      const plat = structuredClone(g);
      offre(plat, "team")["prix_mensuel_ht"] = offre(plat, "solo")["prix_mensuel_ht"];
      assert.ok((await trous(db, await demain(db), plat)).includes("prix_non_croissant"));
    });
  });

  it("monter doit rester une meilleure affaire, à la lecture", async () => {
    await enTour(async (db) => {
      const g = structuredClone(await enVigueur(db));
      // Premium au prix de quatre Team pour les mêmes lectures : monter coûterait plus cher.
      offre(g, "premium")["prix_mensuel_ht"] = Number(offre(g, "team")["prix_mensuel_ht"]) * 4;
      assert.ok((await trous(db, await demain(db), g)).includes("monter_coute_plus_a_la_lecture"));
    });
  });

  it("une recharge moins chère que de monter brûlerait l'offre suivante", async () => {
    await enTour(async (db) => {
      const g = structuredClone(await enVigueur(db));
      const gros = g.recharges.sort((a, b) => a.rang - b.rang).at(-1)!;
      gros["lectures"] = Number(gros["lectures"]) * 100;
      assert.ok((await trous(db, await demain(db), g)).includes("recharge_brule_l_offre_suivante"));
    });
  });

  it("publier pose la grille à sa date, l'inscrit, et refuse une grille trouée", async () => {
    await enTour(async (db) => {
      const g = await enVigueur(db);
      const d = await demain(db);
      await db.query("savepoint avant");
      await assert.rejects(
        db.query("select plateforme.grille_publier($1, $2, $3, 'essai')", [
          g.effective_from,
          JSON.stringify(g.offres),
          JSON.stringify(g.recharges),
        ]),
        /grille_refusee:.*date_passee/,
      );
      await db.query("rollback to savepoint avant");

      const r = await db.query<{ r: { offres: number } }>(
        "select plateforme.grille_publier($1, $2, $3, 'reconduction à l''identique') as r",
        [d, JSON.stringify(g.offres), JSON.stringify(g.recharges)],
      );
      assert.equal(r.rows[0]!.r.offres, 4);
      const posees = await db.query("select 1 from ref.offres where effective_from = $1", [d]);
      assert.equal(posees.rows.length, 4);
      const inscrite = await db.query(
        "select 1 from plateforme.grilles_publiees where effective_from = $1",
        [d],
      );
      assert.equal(inscrite.rows.length, 1);
    });
  });

  it("un client ne lit pas la tour, et ne publie rien", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [randomUUID()]);
      await db.query("savepoint a");
      await assert.rejects(
        db.query("select plateforme.grille_en_vigueur()"),
        (e: { code?: string }) => e.code === "42501",
      );
      await db.query("rollback to savepoint a");
      const l = await db.query("select 1 from plateforme.licences_v");
      assert.equal(l.rows.length, 0);
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
