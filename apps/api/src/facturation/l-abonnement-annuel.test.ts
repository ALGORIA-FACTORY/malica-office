/**
 * L'abonnement annuel (décidé le 19 octobre 2026, réglable par la tour).
 *
 * Douze mois à partir du premier du mois suivant ; (12 − offerts) × le prix
 * de l'offre, payé en ligne ; le mois où l'année commence porte la ligne, une
 * fois ; un mois couvert sans rien d'autre ne produit aucune facture ; l'offre
 * ne change pas pendant l'année. Les prix et les mois offerts se lisent dans
 * la base, jamais ici. Tout se passe dans une transaction annulée.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("l'abonnement annuel", { skip: !ADMIN }, () => {
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

  async function sous<T>(db: pg.PoolClient, qui: string, corps: () => Promise<T>): Promise<T> {
    await db.query("savepoint sous_role");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
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

  async function societeSolo(db: pg.PoolClient) {
    const principal = randomUUID();
    const o = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', 'Annuel d''essai', 'TN', 'TND') returning id`,
    );
    const tenant = o.rows[0]!.id;
    await db.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [tenant, principal],
    );
    await db.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
      principal,
      "Wissem Barouni",
    ]);
    const l = await db.query<{ id: string }>(
      `insert into facturation.licences (titulaire, offre_code, offre_depuis)
       values ($1, 'solo', current_date) returning id`,
      [principal],
    );
    await db.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [l.rows[0]!.id, tenant],
    );
    return { principal, tenant, licence: l.rows[0]!.id };
  }

  async function emetteur(db: pg.PoolClient) {
    const operateur = randomUUID();
    await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
    const em = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', 'Emetteur d''essai', 'TN', 'TND') returning id`,
    );
    await db.query(
      `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
       values ($1, date '2026-01-01', $2)`,
      [em.rows[0]!.id, operateur],
    );
    return operateur;
  }

  const mois = async (db: pg.PoolClient, k: number) =>
    (
      await db.query<{ m: string }>(
        `select (date_trunc('month', current_date) + make_interval(months => $1))::date::text as m`,
        [k],
      )
    ).rows[0]!.m;

  it("l'année se propose, se souscrit, se paie, et fige l'offre", async () => {
    await aBlanc(async (db) => {
      const s = await societeSolo(db);
      const operateur = await emetteur(db);
      const prix = Number(
        (
          await db.query<{ p: string }>(
            "select prix_mensuel_ht as p from ref.offre_a('solo', current_date)",
          )
        ).rows[0]!.p,
      );
      const offerts = Number(
        (
          await db.query<{ r: { annuel_mois_offerts: number } }>(
            "select public.abonnement_reglage() as r",
          )
        ).rows[0]!.r.annuel_mois_offerts,
      );

      const avant = await sous(db, s.principal, async () => {
        const { rows } = await db.query<{
          r: {
            ferme: string | null;
            proposition: { du: string; montant_ht: string; ttc: string | null };
          };
        }>("select public.mon_annuel($1) as r", [s.tenant]);
        return rows[0]!.r;
      });
      assert.equal(avant.ferme, null);
      assert.equal(avant.proposition.du, await mois(db, 1), "l'année commence le mois prochain");
      assert.equal(Number(avant.proposition.montant_ht), prix * (12 - offerts));
      assert.ok(avant.proposition.ttc !== null, "le TTC vient de la fiscalité de la facture");

      const r = await sous(db, s.principal, async () => {
        const { rows } = await db.query<{ r: { paiement: { objet: string; montant_ht: string } } }>(
          "select public.annuel_souscrire($1) as r",
          [s.tenant],
        );
        return rows[0]!.r;
      });
      assert.equal(r.paiement.objet, "annuel");
      assert.equal(Number(r.paiement.montant_ht), prix * (12 - offerts));

      await assert.rejects(
        sous(db, s.principal, () => db.query("select public.annuel_souscrire($1)", [s.tenant])),
        /annuel_refuse:deja_engage/,
      );
      await assert.rejects(
        sous(db, s.principal, () =>
          db.query("select public.forfait_changer('team', $1)", [s.tenant]),
        ),
        /forfait_refuse:engagement_annuel/,
      );
      const team = await sous(db, s.principal, async () => {
        const { rows } = await db.query<{ e: string | null }>(
          "select empechement as e from public.mes_offres($1) where code = 'team'",
          [s.tenant],
        );
        return rows[0]!.e;
      });
      assert.equal(team, "engagement_annuel", "l'écran le dit avant le geste");

      const emettre = (periode: string) =>
        sous(db, operateur, async () => {
          const { rows } = await db.query<{
            r: { factures: Array<{ facture_id: string }>; couvert_par?: string };
          }>("select facturation.emettre($1, $2::date) as r", [s.licence, periode]);
          return rows[0]!.r;
        });
      const lignes = async (factureId: string) =>
        (
          await db.query<{ libelle: string; montant_ht: string }>(
            "select libelle, montant_ht from facturation.facture_lignes where facture_id = $1 order by ordinal",
            [factureId],
          )
        ).rows;

      // Le mois en cours reste au mois.
      const ce = await emettre(await mois(db, 0));
      const l0 = await lignes(ce.factures[0]!.facture_id);
      assert.match(l0[0]!.libelle, /^Abonnement solo/);

      // Le premier mois de l'année porte la ligne annuelle, et rien de mensuel.
      const debut = await emettre(await mois(db, 1));
      const l1 = await lignes(debut.factures[0]!.facture_id);
      assert.equal(l1.length, 1);
      assert.match(l1[0]!.libelle, /^Abonnement annuel solo/);
      assert.equal(Number(l1[0]!.montant_ht), prix * (12 - offerts));

      // Un mois couvert, sans rien d'autre : aucune facture.
      const couvert = await emettre(await mois(db, 2));
      assert.equal(couvert.couvert_par, "annuel");
      assert.equal(couvert.factures.length, 0);
    });
  });

  it("la tour ferme l'année : elle ne se propose plus", async () => {
    await aBlanc(async (db) => {
      const s = await societeSolo(db);
      await db.query(
        `insert into plateforme.reglages_abonnement (report_mois, annuel_ouvert, annuel_mois_offerts, motif, decide_le)
         values (1, false, 2, 'essai : année fermée', now() + interval '1 second')`,
      );
      const etat = await sous(db, s.principal, async () => {
        const { rows } = await db.query<{ r: Record<string, unknown> }>(
          "select public.mon_annuel($1) as r",
          [s.tenant],
        );
        return rows[0]!.r;
      });
      assert.equal(etat["ferme"], "annuel_ferme");
      await assert.rejects(
        sous(db, s.principal, () => db.query("select public.annuel_souscrire($1)", [s.tenant])),
        /annuel_refuse:annuel_ferme/,
      );
    });
  });

  it("qui n'est pas propriétaire principal ne voit pas l'année, et ne la souscrit pas", async () => {
    await aBlanc(async (db) => {
      const s = await societeSolo(db);
      // Le Solo ne porte aucune place : l'autre personne n'est que de passage.
      const autre = randomUUID();
      await assert.rejects(
        sous(db, autre, () => db.query("select public.annuel_souscrire($1)", [s.tenant])),
        /proprietaire principal/,
      );
      const etat = await sous(db, autre, async () => {
        const { rows } = await db.query<{ r: unknown }>("select public.mon_annuel($1) as r", [
          s.tenant,
        ]);
        return rows[0]!.r;
      });
      assert.equal(etat, null);
    });
  });
});
