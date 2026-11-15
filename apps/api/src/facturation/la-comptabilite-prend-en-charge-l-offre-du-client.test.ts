/**
 * La comptabilité prend en charge l'offre que le client a prise à sa charge
 * (recette du 13 novembre 2026, B7), et l'arrêt dit l'offre du client (B6).
 *
 * Couvert en Team, monté en Premium à sa charge : « Prendre en charge
 * Premium » est accepté par la porte, et CHAQUE JOUR le prix de l'offre se
 * partage entre la comptabilité et la société, ni plus ni moins. Quand la
 * comptabilité arrête, la société paie l'offre entière dès le jour de
 * l'arrêt — mesuré jour par jour, aucun jour sans payeur, aucun payé deux fois
 * — et l'alerte nomme Premium, l'offre que la société garde.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-comptabilite-prend-en-charge-l-offre-du-client.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import {
  changerDOffre,
  couvreDepuisLeDebutDuMois,
  decor,
  enPersonne,
  jourParJour,
  millimes,
  paliers,
  prix,
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

describe("la comptabilité prend en charge l'offre du client", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("B7 : couvert en Team, monté en Premium : la comptabilité prend Premium en charge, et chaque jour se paie une fois", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team");
      const c = await uneComptabilite(db, d);
      const acces = await couvreDepuisLeDebutDuMois(db, d, c, "team");
      const [team, premium] = [await prix(db, "team"), await prix(db, "premium")];
      const acompte = await changerDOffre(db, d, "premium");
      assert.ok(acompte, "le client règle l'écart du mois");

      const effet = await enPersonne(db, c.expert, async () => {
        const { rows } = await db.query<{ r: { effet: string } }>(
          "select public.acces_changer_offre($1, 'premium') as r",
          [acces],
        );
        return rows[0]!.r.effet;
      });
      assert.equal(effet, "immediat");

      const jours = await jourParJour(db, d.licence, d.mois, d.moisDApres);
      for (const j of jours) {
        assert.equal(
          millimes(j.comptabilite + j.pme),
          j.jour < d.jour ? team : premium,
          `${j.jour} : le prix de l'offre due, ni plus ni moins`,
        );
      }
      // Ce que le client a réglé d'avance court jusqu'à son terme ; le mois suivant, la
      // comptabilité paie Premium en entier et la société plus rien.
      const apres = jours.filter((j) => j.jour >= d.moisSuivant);
      assert.ok(apres.length > 0);
      for (const j of apres) {
        assert.equal(j.offre, "premium", `${j.jour} : Premium`);
        assert.equal(millimes(j.comptabilite), premium, `${j.jour} : la comptabilité paie Premium`);
        assert.equal(j.pme, 0, `${j.jour} : la société ne paie plus rien`);
      }
      assert.ok(paliers(jours).length >= 2);
    });
  });

  it("B6 : la comptabilité arrête alors que le client est monté : la société paie l'offre entière dès l'arrêt, et l'alerte dit Premium", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team");
      const c = await uneComptabilite(db, d);
      const acces = await couvreDepuisLeDebutDuMois(db, d, c, "team");
      const [team, premium] = [await prix(db, "team"), await prix(db, "premium")];
      await changerDOffre(db, d, "premium");

      const r = await enPersonne(db, c.expert, async () => {
        const { rows } = await db.query<{ r: { effet: string } }>(
          "select public.acces_arreter($1) as r",
          [acces],
        );
        return rows[0]!.r;
      });
      assert.equal(r.effet, "rendu_au_dirigeant");

      // Jour par jour, ce mois-ci et le suivant : un payeur chaque jour, pour le prix dû.
      const jours = await jourParJour(db, d.licence, d.mois, d.moisDApres);
      for (const j of jours) {
        const du = j.jour < d.jour ? team : premium;
        assert.equal(millimes(j.comptabilite + j.pme), du, `${j.jour} : le prix de l'offre due`);
        if (j.jour >= d.jour) {
          assert.equal(j.comptabilite, 0, `${j.jour} : la comptabilité ne paie plus`);
          assert.equal(millimes(j.pme), premium, `${j.jour} : la société paie Premium en entier`);
        } else {
          assert.equal(millimes(j.comptabilite), team, `${j.jour} : couvert par la comptabilité`);
        }
      }

      const n = await db.query<{ payload: { offre: string; offre_couverte: string } }>(
        "select payload from collab.notifications where tenant_id = $1 and kind = 'acces.arrete'",
        [d.tenant],
      );
      assert.equal(n.rows.length, 1);
      assert.equal(n.rows[0]!.payload.offre, "premium", "l'alerte dit l'offre que le client garde");
      assert.equal(
        n.rows[0]!.payload.offre_couverte,
        "team",
        "l'offre couverte reste dite, à part",
      );
    });
  });

  it("B6 : sans montée du client, l'alerte dit l'offre couverte, qui est aussi la sienne", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team");
      const c = await uneComptabilite(db, d);
      const acces = await couvreDepuisLeDebutDuMois(db, d, c, "team");
      await enPersonne(db, c.expert, () => db.query("select public.acces_arreter($1)", [acces]));
      const n = await db.query<{ payload: { offre: string } }>(
        "select payload from collab.notifications where tenant_id = $1 and kind = 'acces.arrete'",
        [d.tenant],
      );
      assert.equal(n.rows[0]!.payload.offre, "team");
    });
  });
});
