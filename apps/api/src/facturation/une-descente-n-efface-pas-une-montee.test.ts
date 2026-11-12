/**
 * Une descente n'efface pas une montée (recette du 11 novembre 2026, point
 * 1.4, migration 20261218090000).
 *
 * Solo → Premium, puis Premium → Team avant d'avoir réglé : la somme à régler
 * disparaissait. La règle : une montée engagée par la PME reste due jusqu'à
 * son échéance — la fin du mois, périmètre « PME » coupé ; la fin de la
 * période déjà facturée, périmètre ouvert. Les deux régimes sont éprouvés,
 * par les vraies portes, sous l'identité du dirigeant titulaire.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/une-descente-n-efface-pas-une-montee.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import {
  changerDOffre,
  couvreDepuisLeDebutDuMois,
  decor,
  enPersonne,
  factureDeLaComptabilite,
  factureDeLaPme,
  facturesDAvance,
  jourParJour,
  millimes,
  monteeARegler,
  ouvrirLePerimetrePme,
  paliers,
  passer,
  prix,
  uneComptabilite,
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

/** L'état des acomptes de montée, tel que la page Abonnement le lit (sous le titulaire). */
const etatsDesAcomptes = (db: pg.PoolClient, d: Decor) =>
  enPersonne(db, d.titulaire, async () => {
    const { rows } = await db.query<{ paiement_id: string; etat: string }>(
      `select paiement_id, etat from facturation.paiements_en_ligne_v
        where licence_id = $1 and objet = 'montee'`,
      [d.licence],
    );
    return new Map(rows.map((r) => [r.paiement_id, r.etat]));
  });

const offreCourante = async (db: pg.PoolClient, d: Decor) =>
  (
    await db.query<{ offre_code: string }>(
      "select offre_code from facturation.forfait_courant_v where licence_id = $1",
      [d.licence],
    )
  ).rows[0]!.offre_code;

describe("une descente n'efface pas une montée", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("périmètre coupé : Solo → Premium puis Team le même jour, sans avoir réglé — la montée reste à régler, et la facture du mois la porte", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const [solo, team, premium] = [
        await prix(db, "solo"),
        await prix(db, "team"),
        await prix(db, "premium"),
      ];

      const acompte = await changerDOffre(db, d, "premium");
      assert.ok(acompte, "la montée prépare son acompte");
      const ecartDuMois = millimes(((premium - solo) * d.joursRestants) / d.joursDuMois);
      assert.equal(Number(acompte.montant_ht), ecartDuMois);

      // La descente, le même jour, sans avoir réglé.
      await changerDOffre(db, d, "team");
      assert.equal(await offreCourante(db, d), "team", "les droits suivent la descente");

      const encore = await monteeARegler(db, d);
      assert.ok(encore, "la montée reste à régler");
      assert.equal(encore.paiement_id, acompte.paiement_id);
      assert.equal(encore.etat, "a_payer");
      assert.equal((await etatsDesAcomptes(db, d)).get(acompte.paiement_id), "a_payer");

      // Jour par jour : Premium reste dû jusqu'à la fin du mois, Team ensuite.
      const jours = await jourParJour(db, d.licence, d.mois, d.moisDApres);
      const attendus: Array<[string, string, number, number]> = [
        [d.mois, "solo", 0, solo],
        [d.jour, "premium", 0, premium],
        [d.moisSuivant, "team", 0, team],
      ];
      assert.deepEqual(paliers(jours), d.jour === d.mois ? attendus.slice(1) : attendus);

      const joursAvant = d.joursDuMois - d.joursRestants;
      assert.equal(
        await factureDeLaPme(db, d.licence, d.mois),
        millimes((solo * joursAvant + premium * d.joursRestants) / d.joursDuMois),
        "la facture du mois : Solo jusqu'à la veille, Premium ensuite",
      );
      assert.equal(await factureDeLaPme(db, d.licence, d.moisSuivant), team);

      // Remonter en Premium dans le même mois ne se paie pas une seconde fois.
      const remontee = await changerDOffre(db, d, "premium");
      assert.equal(remontee?.paiement_id, acompte.paiement_id, "le même acompte, pas un second");
      const etats = await etatsDesAcomptes(db, d);
      assert.equal(etats.size, 1);
      assert.equal(
        await factureDeLaPme(db, d.licence, d.mois),
        millimes((solo * joursAvant + premium * d.joursRestants) / d.joursDuMois),
      );
    });
  });

  it("périmètre coupé : une montée remplacée par une montée plus haute ne se paie toujours plus (2 novembre)", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const premiere = await changerDOffre(db, d, "team");
      const seconde = await changerDOffre(db, d, "premium");
      assert.ok(premiere && seconde);
      const etats = await etatsDesAcomptes(db, d);
      assert.equal(etats.get(premiere.paiement_id), "remplace");
      assert.equal(etats.get(seconde.paiement_id), "a_payer");
    });
  });

  it("périmètre coupé : une descente sans montée dans le mois reste au prorata des jours", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team");
      const [solo, team] = [await prix(db, "solo"), await prix(db, "team")];
      assert.equal(await changerDOffre(db, d, "solo"), null, "rien à régler");
      const joursAvant = d.joursDuMois - d.joursRestants;
      assert.equal(
        await factureDeLaPme(db, d.licence, d.mois),
        millimes((team * joursAvant + solo * d.joursRestants) / d.joursDuMois),
      );
    });
  });

  it("périmètre coupé, deux payeurs : la comptabilité paie Team, le dirigeant monte en Premium puis redescend — son écart reste dû, la comptabilité ne paie rien de plus", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team");
      const c = await uneComptabilite(db, d);
      await couvreDepuisLeDebutDuMois(db, d, c, "team");
      const [team, premium] = [await prix(db, "team"), await prix(db, "premium")];

      const acompte = await changerDOffre(db, d, "premium");
      assert.ok(acompte);
      await changerDOffre(db, d, "team");

      const jours = await jourParJour(db, d.licence, d.jour, d.moisDApres);
      assert.deepEqual(paliers(jours), [
        [d.jour, "premium", team, millimes(premium - team)],
        [d.moisSuivant, "team", team, 0],
      ]);
      assert.equal(await factureDeLaComptabilite(db, c.cabinet, d.licence, d.mois), team);
      assert.equal(await factureDeLaPme(db, d.licence, d.mois), Number(acompte.montant_ht));
      assert.equal((await monteeARegler(db, d))?.paiement_id, acompte.paiement_id);
    });
  });

  it("périmètre ouvert : le complément de la montée reste dû après la descente, et l'échéance suivante part au prix de Team", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const [solo, team, premium] = [
        await prix(db, "solo"),
        await prix(db, "team"),
        await prix(db, "premium"),
      ];
      await ouvrirLePerimetrePme(db, d);
      await passer(db, d.mois);
      const [base] = await facturesDAvance(db, d.licence);
      assert.equal(base!.nature, "base");
      assert.equal(base!.part_mensuelle_ht, solo);

      await enPersonne(db, d.titulaire, () =>
        db.query("select public.forfait_changer('premium', $1)", [d.tenant]),
      );
      const aPayer = await monteeARegler(db, d);
      const avant = await facturesDAvance(db, d.licence);
      const complement = avant.find((f) => f.nature === "complement");
      assert.ok(complement, "la montée émet son complément le jour même");
      assert.equal(complement.part_mensuelle_ht, millimes(premium - solo));
      assert.equal(
        complement.montant_ht,
        millimes(((premium - solo) * d.joursRestants) / d.joursDuMois),
      );
      assert.ok(aPayer, "le complément se règle en ligne");

      // La descente, sans avoir réglé.
      await enPersonne(db, d.titulaire, () =>
        db.query("select public.forfait_changer('team', $1)", [d.tenant]),
      );
      await passer(db, d.jour);
      assert.deepEqual(
        await facturesDAvance(db, d.licence),
        avant,
        "ni avoir ni facture de plus : le complément reste dû",
      );
      const encore = await monteeARegler(db, d);
      assert.ok(encore, "le complément reste à régler après la descente");
      assert.equal(encore.paiement_id, aPayer.paiement_id);

      const jours = await jourParJour(db, d.licence, d.jour, d.moisDApres);
      assert.deepEqual(paliers(jours), [
        [d.jour, "premium", 0, premium],
        [d.moisSuivant, "team", 0, team],
      ]);

      await passer(db, d.moisSuivant);
      const toutes = await facturesDAvance(db, d.licence);
      assert.equal(toutes.length, 3);
      assert.equal(toutes[2]!.couvre_du, d.moisSuivant);
      assert.equal(toutes[2]!.part_mensuelle_ht, team, "l'échéance suivante au prix de Team");
    });
  });
});
