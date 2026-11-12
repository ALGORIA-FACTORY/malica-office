/**
 * La montée reste ouverte pendant l'année (décision du 12 novembre 2026,
 * 7.5 ; recette du 11 novembre, 3.6 ; migration 20261218110000).
 *
 * Avant le début de l'année, l'engagement passe sur la nouvelle offre au prix
 * annuel correspondant ; pendant l'année, l'écart se règle pour les jours qui
 * restent ; la descente reste fermée. Les gestes passent par les vraies
 * portes, sous le dirigeant titulaire ; les factures du mois sont émises par
 * la plateforme, périmètre « PME » coupé (l'état du staging) ; le prix couvert
 * par l'année est relu jour par jour. Les prix viennent de la grille.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-montee-pendant-l-annee.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import {
  changerDOffre,
  decor,
  enPersonne,
  millimes,
  prix,
  regler,
  type Decor,
} from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function aBlanc(corps: (db: pg.PoolClient) => Promise<void>) {
  const db = await pool!.connect();
  try {
    await db.query("begin isolation level repeatable read");
    await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

const moisOfferts = async (db: pg.PoolClient) =>
  (
    await db.query<{ n: number }>(
      "select (public.abonnement_reglage() ->> 'annuel_mois_offerts')::int as n",
    )
  ).rows[0]!.n;

interface Emise {
  ht: number;
  lignes: string[];
  couvert: boolean;
}

/** La plateforme émet la facture du mois `periode` (la licence n'a qu'un payeur, le titulaire). */
async function emettre(db: pg.PoolClient, d: Decor, periode: string): Promise<Emise> {
  const r = await enPersonne(db, d.operateur, async () => {
    const { rows } = await db.query<{
      r: { factures: Array<{ facture_id: string; ht: string }>; couvert_par?: string };
    }>("select facturation.emettre($1, $2::date) as r", [d.licence, periode]);
    return rows[0]!.r;
  });
  const f = r.factures[0];
  if (!f) return { ht: 0, lignes: [], couvert: r.couvert_par === "annuel" };
  const { rows } = await db.query<{ libelle: string }>(
    "select libelle from facturation.facture_lignes where facture_id = $1 order by ordinal",
    [f.facture_id],
  );
  return { ht: Number(f.ht), lignes: rows.map((l) => l.libelle), couvert: false };
}

const refusDescente = (db: pg.PoolClient, d: Decor, offre: string) =>
  assert.rejects(
    changerDOffre(db, d, offre),
    /refus\.forfait\.empeche\?motif=engagement_annuel&/,
    `${offre} : la descente reste fermée par l'année`,
  );

/** Chaque jour de [du, au[ : l'offre due et le prix que l'année couvre ce jour-là. */
async function couvertJourParJour(db: pg.PoolClient, d: Decor, du: string, au: string) {
  const { rows } = await db.query<{ jour: string; du_ht: string; couvert: string | null }>(
    `select j::date::text as jour, pv.prix_offre_ht::text as du_ht,
            (facturation.annuel_de($1, j::date)).prix_mensuel_ht::text as couvert
       from generate_series($2::date, $3::date - 1, interval '1 day') j
       join facturation.periodes_v pv
         on pv.licence_id = $1 and pv.du <= j::date and (pv.au_exclu is null or pv.au_exclu > j::date)
      order by 1`,
    [d.licence, du, au],
  );
  return rows;
}

describe("la montée pendant l'année", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("avant le début : la montée passe l'engagement au prix annuel de Premium ; la descente reste fermée", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const offerts = await moisOfferts(db);
      const [solo, premium] = [await prix(db, "solo"), await prix(db, "premium")];
      await enPersonne(db, d.titulaire, () =>
        db.query("select public.annuel_souscrire($1)", [d.tenant]),
      );

      await refusDescente(db, d, "basic");
      const acompte = await changerDOffre(db, d, "premium");
      assert.ok(acompte, "la montée se règle le jour même");
      const duMois = millimes(((premium - solo) * d.joursRestants) / d.joursDuMois);
      const deLAnnee = (premium - solo) * (12 - offerts);
      assert.equal(Number(acompte.montant_ht), millimes(duMois + deLAnnee));
      await refusDescente(db, d, "team");

      const etat = await enPersonne(db, d.titulaire, async () => {
        const { rows } = await db.query<{ r: { en_cours: { offre: string } } }>(
          "select public.mon_annuel($1) as r",
          [d.tenant],
        );
        return rows[0]!.r.en_cours;
      });
      assert.equal(etat.offre, "premium", "l'année est en Premium");

      // Ce mois-ci : les jours au mois (Solo puis Premium), et l'écart de l'année.
      const ce = await emettre(db, d, d.mois);
      const joursAvant = d.joursDuMois - d.joursRestants;
      assert.equal(
        ce.ht,
        millimes(
          millimes((solo * joursAvant + premium * d.joursRestants) / d.joursDuMois) + deLAnnee,
        ),
      );
      assert.ok(ce.lignes.some((l) => l.startsWith("Abonnement annuel : passage Solo -> Premium")));
      // Le premier mois de l'année : la ligne de l'année Solo, et rien d'autre.
      const debut = await emettre(db, d, d.moisSuivant);
      assert.equal(debut.ht, solo * (12 - offerts));
      assert.equal(debut.lignes.length, 1);
      assert.equal(
        millimes(debut.ht + deLAnnee),
        premium * (12 - offerts),
        "au total, l'année Premium au prix annuel",
      );
      // Ensuite : couvert, chaque jour, au prix de Premium.
      assert.equal((await emettre(db, d, d.moisDApres)).couvert, true);
      for (const j of await couvertJourParJour(db, d, d.moisSuivant, d.moisDApres)) {
        assert.equal(Number(j.couvert), Number(j.du_ht), `${j.jour} : couvert par l'année`);
      }
    });
  });

  it("pendant l'année : l'écart des jours qui restent, le jour même, puis l'année continue en Premium", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const offerts = await moisOfferts(db);
      const [solo, premium] = [await prix(db, "solo"), await prix(db, "premium")];
      // Une année qui a commencé le premier du mois (souscrite le mois dernier).
      const { rows: e } = await db.query<{ au: string; jr: number; ja: number }>(
        `insert into facturation.engagements_annuels
           (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
         values ($1, 'solo', $2::date, ($2::date + interval '1 year - 1 day')::date, $3::numeric, $4::int,
                 $3::numeric * (12 - $4::int), $5)
         returning au::text, (au + 1 - current_date) as jr, (au + 1 - du) as ja`,
        [d.licence, d.mois, solo, offerts, d.titulaire],
      );
      const { jr, ja } = e[0]!;

      const acompte = await changerDOffre(db, d, "premium");
      assert.ok(acompte);
      const ecart = millimes(((premium - solo) * 12 * jr) / ja);
      assert.equal(
        Number(acompte.montant_ht),
        ecart,
        "l'écart × 12 × jours restants / jours de l'année",
      );
      await refusDescente(db, d, "team");

      // Le mois en cours : la ligne de l'année Solo et la montée ; aucun jour au mois.
      const ce = await emettre(db, d, d.mois);
      assert.equal(ce.ht, millimes(solo * (12 - offerts) + ecart));
      assert.equal(ce.lignes.length, 2);
      assert.ok(ce.lignes[1]!.includes(`(${jr}/${ja} jours)`), ce.lignes[1]);
      // Chaque jour du mois, puis du suivant : l'offre due est couverte par l'année.
      for (const j of await couvertJourParJour(db, d, d.mois, d.moisDApres)) {
        assert.equal(Number(j.couvert), Number(j.du_ht), `${j.jour} : couvert par l'année`);
      }
      assert.equal((await emettre(db, d, d.moisSuivant)).couvert, true, "rien de plus ensuite");
    });
  });

  it("pendant l'année, deux montées avant d'avoir réglé la première : « À régler » porte les deux écarts, la facture aussi, une fois", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const offerts = await moisOfferts(db);
      const [solo, team, premium] = [
        await prix(db, "solo"),
        await prix(db, "team"),
        await prix(db, "premium"),
      ];
      const { rows: e } = await db.query<{ jr: number; ja: number }>(
        `insert into facturation.engagements_annuels
           (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
         values ($1, 'solo', $2::date, ($2::date + interval '1 year - 1 day')::date, $3::numeric,
                 $4::int, $3::numeric * (12 - $4::int), $5)
         returning (au + 1 - current_date) as jr, (au + 1 - du) as ja`,
        [d.licence, d.mois, solo, offerts, d.titulaire],
      );
      const { jr, ja } = e[0]!;
      const ecart1 = millimes(((team - solo) * 12 * jr) / ja);
      const ecart2 = millimes(((premium - team) * 12 * jr) / ja);

      const premiere = await changerDOffre(db, d, "team");
      assert.equal(Number(premiere!.montant_ht), ecart1);
      const seconde = await changerDOffre(db, d, "premium");
      assert.ok(seconde);

      // « À régler », tel que la page le lit : ni payé, ni remplacé.
      const ouverts = await enPersonne(db, d.titulaire, async () => {
        const { rows } = await db.query<{ montant_ht: string }>(
          `select montant_ht::text from facturation.paiements_en_ligne_v
            where licence_id = $1 and etat not in ('paye', 'remplace')`,
          [d.licence],
        );
        return rows.map((r) => Number(r.montant_ht));
      });
      assert.deepEqual(
        ouverts,
        [millimes(ecart1 + ecart2)],
        "aucun écart caché, aucun compté deux fois",
      );

      const ce = await emettre(db, d, d.mois);
      assert.equal(ce.ht, millimes(solo * (12 - offerts) + ecart1 + ecart2));
      assert.equal(ce.lignes.length, 3, "l'année, et une ligne par montée");
    });
  });

  it("pendant l'année, la première montée déjà réglée : la seconde ne porte que son écart", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const offerts = await moisOfferts(db);
      const [solo, team, premium] = [
        await prix(db, "solo"),
        await prix(db, "team"),
        await prix(db, "premium"),
      ];
      const { rows: e } = await db.query<{ jr: number; ja: number }>(
        `insert into facturation.engagements_annuels
           (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
         values ($1, 'solo', $2::date, ($2::date + interval '1 year - 1 day')::date, $3::numeric,
                 $4::int, $3::numeric * (12 - $4::int), $5)
         returning (au + 1 - current_date) as jr, (au + 1 - du) as ja`,
        [d.licence, d.mois, solo, offerts, d.titulaire],
      );
      const { jr, ja } = e[0]!;
      const premiere = await changerDOffre(db, d, "team");
      await regler(db, d, premiere!.paiement_id);
      const seconde = await changerDOffre(db, d, "premium");
      assert.equal(Number(seconde!.montant_ht), millimes(((premium - team) * 12 * jr) / ja));
    });
  });
});
