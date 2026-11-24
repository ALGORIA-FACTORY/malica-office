/**
 * Les CGV s'acceptent avant de payer, et l'acceptation se garde avec le paiement
 * (CGV publiées, art. 2 et 17 ; recette Flouci du 24 novembre 2026 — 20261231260000).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/les-cgv-s-acceptent-avant-de-payer.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type pg from "pg";

import {
  ADMIN,
  pool,
  aBlanc,
  enPersonne,
  passer,
  socle,
  regler,
  unePme,
  jourDe,
  demander,
  type Socle,
  type Pme,
} from "./decor-d-avance.ts";

/** Un paiement à régler : la montée Basic → Solo d'une société qui a payé Basic d'avance. */
async function unPaiement(db: pg.PoolClient): Promise<{ s: Socle; p: Pme; id: string }> {
  const s = await socle(db);
  const ancre = await jourDe(db, -5);
  await regler(db, s, "pme", true);
  const p = await unePme(db, ancre, "basic");
  await passer(db, ancre);
  const r = await demander(db, p, "solo");
  return { s, p, id: r.paiement!.paiement_id };
}

const LIEN =
  "select public.paiement_inscrire($1, 'lien_cree', 'clictopay', 'REF-C', 'https://test.clictopay.com/pay/REF-C', '{}', 'visa')";

/** Un refus attendu, sans perdre la transaction de l'épreuve. */
async function refuse(db: pg.PoolClient, sql: string, args: unknown[], cle: RegExp) {
  await db.query("savepoint refus");
  await assert.rejects(db.query(sql, args), cle);
  await db.query("rollback to savepoint refus");
}

async function enVigueur(db: pg.PoolClient): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select (plateforme.cgv_en_vigueur()).id as id");
  return rows[0]!.id;
}

describe("les CGV s'acceptent avant de payer", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("sans les CGV acceptées, la page de paiement ne s'ouvre pas", async () => {
    await aBlanc(async (db) => {
      const { p, id } = await unPaiement(db);
      await enPersonne(db, p.titulaire);
      await refuse(db, LIEN, [id], /refus\.cgv\.non_acceptees/);
      await db.query("reset role");
    });
  });

  it("acceptées : la version, la personne et l'instant sont gardés, et la page s'ouvre", async () => {
    await aBlanc(async (db) => {
      const { p, id } = await unPaiement(db);
      const cgv = await enVigueur(db);
      await enPersonne(db, p.titulaire);
      await db.query("select public.paiement_cgv_accepter($1, $2)", [id, cgv]);
      await db.query(LIEN, [id]);
      const { rows } = await db.query<{ cgv_id: string; acceptees_par: string }>(
        "select cgv_id, acceptees_par from facturation.acceptations_cgv where paiement_id = $1",
        [id],
      );
      await db.query("reset role");
      assert.deepEqual(rows[0], { cgv_id: cgv, acceptees_par: p.titulaire });
      const { rows: v } = await db.query<{ url: string; version: string }>(
        "select url, version::text from plateforme.conditions_de_vente where id = $1",
        [cgv],
      );
      assert.match(v[0]!.url, /^https:\/\//);
    });
  });

  it("une version périmée ne fait pas foi : la tour en publie une nouvelle, l'ancienne est refusée", async () => {
    await aBlanc(async (db) => {
      const { s, p, id } = await unPaiement(db);
      const ancienne = await enVigueur(db);
      await enPersonne(db, s.operateur);
      await db.query(
        "select plateforme.cgv_regler(current_date, 'https://cgv.exemple.tn/v2/', current_date, 'Essai : nouvelle version')",
      );
      await db.query("reset role");
      assert.notEqual(await enVigueur(db), ancienne);
      await enPersonne(db, p.titulaire);
      await refuse(
        db,
        "select public.paiement_cgv_accepter($1, $2)",
        [id, ancienne],
        /refus\.cgv\.version_perimee/,
      );
      await db.query("reset role");
    });
  });

  it("personne d'autre n'accepte à la place du payeur, et seule la plateforme publie une version", async () => {
    await aBlanc(async (db) => {
      const { s, id } = await unPaiement(db);
      const cgv = await enVigueur(db);
      await enPersonne(db, s.intrus);
      await refuse(
        db,
        "select public.paiement_cgv_accepter($1, $2)",
        [id, cgv],
        /refus\.introuvable\.paiement/,
      );
      await refuse(
        db,
        "select plateforme.cgv_regler(current_date, 'https://cgv.exemple.tn/', current_date, 'intrus')",
        [],
        /refus\.reserve\.plateforme/,
      );
      await db.query("reset role");
    });
  });
});
