/**
 * Un jour ne se paie pas deux fois (recette du 11 novembre 2026, point 1.1,
 * migration 20261218090000).
 *
 * La règle : ce que la PME a engagé d'avance reste à elle jusqu'à son
 * échéance ; la comptabilité qui reprend, ou qui monte par-dessus, n'est
 * facturée de cette tranche qu'à partir de cette échéance.
 *
 * Les gestes passent par les vraies portes, sous l'identité de qui les fait
 * (le dirigeant titulaire, l'expert), aujourd'hui ; la facture du mois se lit
 * ensuite jour par jour, pour la comptabilité et pour la PME. Les prix
 * viennent de la grille.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/un-jour-ne-se-paie-pas-deux-fois.test.ts
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
  ouvrirLePerimetrePme,
  paliers,
  passer,
  prix,
  regler,
  uneComptabilite,
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

describe("un jour ne se paie pas deux fois", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("la comptabilité couvre Solo, le dirigeant paie sa montée en Premium, la comptabilité monte en Team le même jour : elle reste à Solo jusqu'à la fin du mois", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const c = await uneComptabilite(db, d);
      const acces = await couvreDepuisLeDebutDuMois(db, d, c, "solo");
      const [solo, team, premium] = [
        await prix(db, "solo"),
        await prix(db, "team"),
        await prix(db, "premium"),
      ];

      // 2. Le dirigeant monte en Premium et règle l'écart jusqu'à la fin du mois.
      const acompte = await changerDOffre(db, d, "premium");
      assert.ok(acompte, "la montée prépare son acompte");
      const ecartDuMois = millimes(((premium - solo) * d.joursRestants) / d.joursDuMois);
      assert.equal(Number(acompte.montant_ht), ecartDuMois, "l'écart × jours restants / jours");
      await regler(db, d, acompte.paiement_id);

      // 3. Le même jour, la comptabilité monte : Premium est l'offre du client,
      // elle ne s'y « monte » pas (1.2) ; Team, oui.
      await assert.rejects(
        enPersonne(db, c.expert, () =>
          db.query("select public.acces_changer_offre($1, 'premium')", [acces]),
        ),
        /refus\.abonnement\.deja_l_offre_du_client$/,
      );
      const effet = await enPersonne(db, c.expert, async () => {
        const { rows } = await db.query<{ r: { effet: string } }>(
          "select public.acces_changer_offre($1, 'team') as r",
          [acces],
        );
        return rows[0]!.r.effet;
      });
      assert.equal(effet, "immediat");

      // Jour par jour : ce mois-ci, puis le suivant.
      const jours = await jourParJour(db, d.licence, d.mois, d.moisDApres);
      for (const j of jours) {
        assert.equal(
          millimes(j.comptabilite + j.pme),
          j.jour < d.jour ? solo : premium,
          `${j.jour} : le prix de l'offre, ni plus ni moins`,
        );
      }
      const attendus: Array<[string, string, number, number]> = [
        [d.mois, "solo", solo, 0],
        [d.jour, "premium", solo, millimes(premium - solo)],
        [d.moisSuivant, "premium", team, millimes(premium - team)],
      ];
      assert.deepEqual(
        paliers(jours),
        d.jour === d.mois ? attendus.slice(1) : attendus,
        "la comptabilité reste à Solo tant que court ce que le dirigeant a payé",
      );

      // La facture du mois, des deux côtés.
      assert.equal(
        await factureDeLaComptabilite(db, c.cabinet, d.licence, d.mois),
        solo,
        "la comptabilité : Solo tout le mois, pas un jour de Team",
      );
      assert.equal(
        await factureDeLaPme(db, d.licence, d.mois),
        ecartDuMois,
        "la PME : exactement ce qu'elle a réglé d'avance",
      );
      assert.equal(await factureDeLaComptabilite(db, c.cabinet, d.licence, d.moisSuivant), team);
      assert.equal(await factureDeLaPme(db, d.licence, d.moisSuivant), millimes(premium - team));
    });
  });

  it("la PME a payé sa montée, puis accepte la prise en charge : la comptabilité ne paie ce mois-ci que ce que la PME n'avait pas engagé", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const [solo, team, premium] = [
        await prix(db, "solo"),
        await prix(db, "team"),
        await prix(db, "premium"),
      ];
      const acompte = await changerDOffre(db, d, "premium");
      assert.ok(acompte);
      const ecartDuMois = millimes(((premium - solo) * d.joursRestants) / d.joursDuMois);
      assert.equal(Number(acompte.montant_ht), ecartDuMois);
      await regler(db, d, acompte.paiement_id);

      const c = await uneComptabilite(db, d);
      const propose = await enPersonne(db, c.expert, async () => {
        const { rows } = await db.query<{ id: string }>(
          "select public.acces_proposer($1, $2, 'team') as id",
          [c.cabinet, d.tenant],
        );
        return rows[0]!.id;
      });
      await enPersonne(db, d.titulaire, () =>
        db.query("select public.acces_repondre($1, true)", [propose]),
      );

      const jours = await jourParJour(db, d.licence, d.mois, d.moisDApres);
      const attendus: Array<[string, string, number, number]> = [
        [d.mois, "solo", 0, solo],
        // La PME avait engagé la tranche Solo → Premium : la comptabilité ne
        // paie d'ici la fin du mois que la base, que la PME n'avait pas payée.
        [d.jour, "premium", solo, millimes(premium - solo)],
        [d.moisSuivant, "premium", team, millimes(premium - team)],
      ];
      assert.deepEqual(paliers(jours), d.jour === d.mois ? attendus.slice(1) : attendus);

      const joursAvant = d.joursDuMois - d.joursRestants;
      assert.equal(
        await factureDeLaComptabilite(db, c.cabinet, d.licence, d.mois),
        millimes((solo * d.joursRestants) / d.joursDuMois),
      );
      assert.equal(
        await factureDeLaPme(db, d.licence, d.mois),
        millimes((solo * joursAvant) / d.joursDuMois + ecartDuMois),
        "la PME : ses jours en Solo, et l'écart qu'elle a réglé d'avance — rien d'autre",
      );
      assert.equal(await factureDeLaComptabilite(db, c.cabinet, d.licence, d.moisSuivant), team);
    });
  });

  it("périmètre « PME » ouvert : la comptabilité qui monte par-dessus un complément déjà facturé attend la fin de sa période", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const c = await uneComptabilite(db, d);
      const acces = await couvreDepuisLeDebutDuMois(db, d, c, "solo");
      const [solo, team, premium] = [
        await prix(db, "solo"),
        await prix(db, "team"),
        await prix(db, "premium"),
      ];
      await ouvrirLePerimetrePme(db, d);

      await enPersonne(db, d.titulaire, () =>
        db.query("select public.forfait_changer('premium', $1)", [d.tenant]),
      );
      await passer(db, d.jour);
      const [complement, ...autres] = await facturesDAvance(db, d.licence);
      assert.equal(autres.length, 0);
      assert.equal(complement!.nature, "complement");
      assert.equal(complement!.couvre_du, d.jour);
      assert.equal(complement!.part_mensuelle_ht, millimes(premium - solo));
      const echeance = complement!.couvre_au;

      await enPersonne(db, c.expert, () =>
        db.query("select public.acces_changer_offre($1, 'team')", [acces]),
      );

      const jours = await jourParJour(db, d.licence, d.jour, d.moisDApres);
      assert.deepEqual(paliers(jours), [
        [d.jour, "premium", solo, millimes(premium - solo)],
        [echeance, "premium", team, millimes(premium - team)],
      ]);
      assert.equal(
        await factureDeLaComptabilite(db, c.cabinet, d.licence, d.mois),
        solo,
        "ce mois-ci : Solo, comme avant",
      );
      // Rien de plus n'est facturé à la PME d'ici là : son complément couvre ces
      // jours. À l'échéance, elle ne paie plus que ce qui dépasse Team.
      await passer(db, echeance);
      const [, suivante, ...plus] = await facturesDAvance(db, d.licence);
      assert.equal(plus.length, 0);
      assert.equal(suivante!.couvre_du, echeance);
      assert.equal(suivante!.part_mensuelle_ht, millimes(premium - team));
    });
  });
});
