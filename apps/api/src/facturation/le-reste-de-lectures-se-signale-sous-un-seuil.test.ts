/**
 * Le reste de lectures se signale sous un seuil (pilote, 24 novembre 2026).
 *
 * « Il vous reste 269 lectures sur 280 » paraissait en couleur d'alerte sous les charges. Le
 * seuil est un réglage de la tour (`alerte_lectures_part`), la base rend le verdict
 * (`public.lectures_basses`, porté par `mon_forfait` côté dépôt), et une décision de la tour
 * sur le report ne remet pas le seuil à son défaut.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/le-reste-de-lectures-se-signale-sous-un-seuil.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { decor, enPersonne } from "./decor-de-facture.ts";

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

const part = async (db: pg.PoolClient) =>
  (
    await db.query<{ p: string | null }>(
      "select public.abonnement_reglage() ->> 'alerte_lectures_part' as p",
    )
  ).rows[0]!.p;

const basses = async (db: pg.PoolClient, qui: string, restantes: number, droit: number) =>
  enPersonne(db, qui, async () => {
    const { rows } = await db.query<{ b: boolean }>("select public.lectures_basses($1, $2) as b", [
      restantes,
      droit,
    ]);
    return rows[0]!.b;
  });

/** Une décision de la tour qui pose une autre part, en gardant le reste. */
async function poserLaPart(db: pg.PoolClient, valeur: string) {
  await db.query(
    `insert into plateforme.reglages_abonnement
       (report_mois, annuel_ouvert, annuel_mois_offerts, lien_valide_minutes, alerte_lectures_part,
        motif, decide_le)
     select report_mois, annuel_ouvert, annuel_mois_offerts, lien_valide_minutes, $1::numeric,
            'Essai : part d''alerte', now() + interval '1 second'
       from plateforme.reglages_abonnement order by decide_le desc, id desc limit 1`,
    [valeur],
  );
}

describe("le reste de lectures se signale sous un seuil", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("le seuil vient de la tour ; 269 sur 280 se tait, 28 sur 280 se dit", async () => {
    await aBlanc(async (db) => {
      const p = Number(await part(db));
      assert.ok(p > 0 && p <= 1, "la part est arrêtée en base");
      const d = await decor(db, "premium");
      assert.equal(await basses(db, d.titulaire, 269, 280), false, "à 96 % : rien à signaler");
      assert.equal(
        await basses(db, d.titulaire, Math.floor(280 * p), 280),
        true,
        "au seuil : se dit",
      );
      assert.equal(await basses(db, d.titulaire, 0, 280), true, "plus rien : se dit");
    });
  });

  it("sans droit lu, rien ne se dit", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      assert.equal(await basses(db, d.titulaire, 0, 0), false);
      assert.equal(await basses(db, d.titulaire, null as unknown as number, 280), false);
    });
  });

  it("la tour change la part ; sa décision sur le report ne la remet pas au défaut", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      await poserLaPart(db, "0.250");
      assert.equal(await part(db), "0.250");
      assert.equal(await basses(db, d.titulaire, 70, 280), true, "70 ≤ 25 % de 280");
      assert.equal(await basses(db, d.titulaire, 71, 280), false);

      await enPersonne(db, d.operateur, () =>
        db.query(
          "select plateforme.abonnement_regler(1::smallint, true, 2::smallint, 0::smallint, 14::smallint, 'Essai : report inchangé')",
        ),
      );
      assert.equal(await part(db), "0.250", "la part reste celle de la tour");
    });
  });

  it("le forfait porte le verdict jusqu'à l'écran", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const ligne = await enPersonne(db, d.titulaire, async () => {
        const { rows } = await db.query<{ lectures_basses: boolean | null }>(
          `select public.lectures_basses(lectures_restantes, lectures_droit) as lectures_basses
             from public.mon_forfait($1::uuid)`,
          [d.tenant],
        );
        return rows[0];
      });
      assert.ok(ligne, "le forfait se lit");
      assert.equal(typeof ligne.lectures_basses, "boolean");
    });
  });
});
