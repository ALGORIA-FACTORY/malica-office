/**
 * Le report d'un mois et le TTC de chaque offre (19 octobre 2026).
 *
 * Les lectures du forfait non consommées en M passent sur M+1, et pas plus
 * loin ; la tour l'éteint ou l'allume. Le TTC vient de la fiscalité de la
 * facture, et n'existe pas sans émetteur. Les nombres viennent de la grille,
 * jamais d'ici. Tout se passe dans une transaction annulée.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("le report d'un mois et le TTC", { skip: !ADMIN }, () => {
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

  /** Une société Basic, et sa licence née ce mois-ci. */
  async function licenceBasic(db: pg.PoolClient) {
    const titulaire = randomUUID();
    const o = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', 'Report d''essai', 'TN', 'TND') returning id`,
    );
    const tenant = o.rows[0]!.id;
    await db.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [tenant, titulaire],
    );
    const l = await db.query<{ id: string }>(
      `insert into facturation.licences (titulaire, offre_code, offre_depuis)
       values ($1, 'basic', current_date) returning id`,
      [titulaire],
    );
    const licence = l.rows[0]!.id;
    await db.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [licence, tenant],
    );
    const d = await db.query<{ n: number }>(
      "select lectures_droit as n from facturation.droits_v where licence_id = $1",
      [licence],
    );
    return { titulaire, tenant, licence, droit: Number(d.rows[0]!.n) };
  }

  /** `n` lectures sur le forfait, au mois `periode`. */
  async function lire(
    db: pg.PoolClient,
    x: { titulaire: string; tenant: string; licence: string },
    periode: string,
    n: number,
  ) {
    for (let i = 0; i < n; i++) {
      const p = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by)
         values ($1, 'pdf', 'partage', $2, $2, $3) returning id`,
        [x.tenant, `essai/report-${randomUUID()}.pdf`, x.titulaire],
      );
      await db.query(
        `insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
         values ($1, $2, $3, $4::date, $5)`,
        [x.tenant, x.licence, p.rows[0]!.id, periode, x.titulaire],
      );
    }
  }

  const report = async (db: pg.PoolClient, licence: string, periode: string) =>
    Number(
      (
        await db.query<{ n: number }>("select facturation.report_de($1, $2::date) as n", [
          licence,
          periode,
        ])
      ).rows[0]!.n,
    );

  const mois = async (db: pg.PoolClient, decalage: number) =>
    (
      await db.query<{ m: string }>(
        `select (date_trunc('month', current_date) + make_interval(months => $1))::date::text as m`,
        [decalage],
      )
    ).rows[0]!.m;

  it("ce qui n'a pas été lu ce mois passe au suivant, et pas plus loin", async () => {
    await aBlanc(async (db) => {
      const x = await licenceBasic(db);
      const m0 = await mois(db, 0);
      const m1 = await mois(db, 1);
      const m2 = await mois(db, 2);
      const m3 = await mois(db, 3);
      assert.ok(x.droit > 10, "le Basic porte des lectures");

      assert.equal(await report(db, x.licence, m0), 0, "le premier mois ne reçoit rien");

      await lire(db, x, m0, 4);
      assert.equal(await report(db, x.licence, m1), x.droit - 4, "le reste du mois passe");

      // Le mois suivant lit le report d'abord : 6 lectures entament le report
      // et laissent le forfait entier — qui passe, lui, sans le report.
      await lire(db, x, m1, 6);
      assert.equal(await report(db, x.licence, m2), x.droit, "le report ne se cumule pas");

      // Un mois qui lit plus que son report entame son forfait.
      await lire(db, x, m2, x.droit + 3);
      assert.equal(await report(db, x.licence, m3), x.droit - 3);
    });
  });

  it("la tour éteint le report : plus rien ne passe", async () => {
    await aBlanc(async (db) => {
      const x = await licenceBasic(db);
      const m1 = await mois(db, 1);
      await db.query(
        `insert into plateforme.reglages_abonnement (report_mois, motif, decide_le)
         values (0, 'essai : report éteint', now() + interval '1 second')`,
      );
      assert.equal(await report(db, x.licence, m1), 0);
    });
  });

  it("la décision du 19 octobre est inscrite : le report d'un mois est allumé", async () => {
    await aBlanc(async (db) => {
      const r = await db.query<{ r: { report_mois: number } }>(
        "select public.abonnement_reglage() as r",
      );
      assert.equal(r.rows[0]!.r.report_mois, 1);
    });
  });

  it("le compteur du mois inclut le report, et le dit à part", async () => {
    await aBlanc(async (db) => {
      const x = await licenceBasic(db);
      const c = await db.query<{ droit: number; report: number; forfait: number }>(
        `select lectures_droit as droit, lectures_report as report, lectures_forfait as forfait
           from facturation.consommation_v where licence_id = $1`,
        [x.licence],
      );
      const l = c.rows[0]!;
      assert.equal(Number(l.droit), Number(l.forfait) + Number(l.report));
    });
  });

  it("sans émetteur, pas de TTC ; avec, HT + TVA + timbre", async () => {
    await aBlanc(async (db) => {
      const deja = await db.query(
        "select 1 from facturation.emetteurs where valide_des <= current_date",
      );
      if (deja.rows.length === 0) {
        const sans = await db.query<{ r: unknown }>("select public.prix_ttc(34) as r");
        assert.equal(sans.rows[0]!.r, null, "sans émetteur, aucun taux n'est supposé");
      }

      const o = await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         values ('pme', 'ALGORIA FACTORY', 'TN', 'TND') returning id`,
      );
      await db.query(
        `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
         values ($1, current_date, $2)`,
        [o.rows[0]!.id, randomUUID()],
      );
      const r = await db.query<{
        r: { ht: string; tva: string; timbre: string; ttc: string; taux: string };
      }>("select public.prix_ttc(34) as r");
      const p = r.rows[0]!.r;
      assert.ok(Number(p.taux) > 0 && Number(p.timbre) > 0, "taux et timbre viennent du pack");
      assert.equal(
        Number(p.ttc).toFixed(3),
        (Number(p.ht) + Number(p.tva) + Number(p.timbre)).toFixed(3),
      );

      const offres = await db.query<{ code: string; prix_ttc: string | null }>(
        "select code, prix_ttc from public.mes_offres()",
      );
      assert.ok(offres.rows.length > 0 && offres.rows.every((x) => x.prix_ttc !== null));
    });
  });
});
