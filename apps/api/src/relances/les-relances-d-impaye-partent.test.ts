/**
 * Les relances d'impayé partent (23 octobre 2026) — sur la base.
 *
 * Fermées par défaut ; ouvertes par la tour, une relance par facture et par
 * palier, jamais deux ; la suspension automatique seulement si la tour l'a
 * ouverte ; le travailleur lit le courriel à remettre et l'inscrit. Les
 * seuils se lisent dans `ref.socle_params` : rien n'est écrit ici. Tout se
 * passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function sous<T>(
  db: pg.PoolClient,
  role: string,
  qui: string | null,
  corps: () => Promise<T>,
) {
  await db.query("savepoint sous_role");
  await db.query(`set local role ${role}`);
  if (qui) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
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

/** Une PME sur Solo dont la facture du mois a atteint le palier voulu. */
async function unImpaye(db: pg.PoolClient, palier: "suspension" | "rappel") {
  const titulaire = randomUUID();
  const operateur = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [
    titulaire,
    `${titulaire}@essai.local`,
  ]);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const o = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Relance d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = o.rows[0]!.id;
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, 'Essai')", [
    titulaire,
  ]);
  const l = await db.query<{ id: string }>(
    `insert into facturation.licences (titulaire, offre_code, offre_depuis)
     values ($1, 'solo', current_date) returning id`,
    [titulaire],
  );
  const licence = l.rows[0]!.id;
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );
  const e = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Émetteur d''essai', 'TN', 'TND') returning id`,
  );
  await db.query(
    `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
     values ($1, date '2026-01-01', $2)`,
    [e.rows[0]!.id, operateur],
  );
  const periode = await db.query<{ p: string }>(
    "select to_char(date_trunc('month', current_date), 'YYYY-MM-DD') as p",
  );
  const r = await sous(db, "authenticated", operateur, async () => {
    const { rows } = await db.query<{ r: { factures: Array<{ facture_id: string }> } }>(
      "select facturation.emettre($1, $2::date) as r",
      [licence, periode.rows[0]!.p],
    );
    return rows[0]!.r;
  });
  const facture = r.factures[0]!.facture_id;
  // L'échéance est reculée d'après le seuil du palier voulu, lu dans la base.
  await db.query(
    `update facturation.factures
        set emise_le = current_date - 1 - s.jours, echeance_le = current_date - s.jours
       from (select value_num::int as jours from ref.socle_params
              where code = $2 and valid_from <= current_date
                and (valid_to is null or valid_to >= current_date)) s
      where id = $1`,
    [facture, `recouvrement.${palier === "suspension" ? "suspension" : "rappel"}_jours`],
  );
  return { titulaire, operateur, licence, facture };
}

const regler = (db: pg.PoolClient, operateur: string, actives: boolean, suspension: boolean) =>
  sous(db, "authenticated", operateur, () =>
    db.query("select plateforme.relances_regler($1, $2, 'essai')", [actives, suspension]),
  );

const relancer = (db: pg.PoolClient) =>
  sous(db, "malica_api", null, async () => {
    const { rows } = await db.query<{ r: Record<string, number | boolean> }>(
      "select notif.relancer_les_impayes() as r",
    );
    return rows[0]!.r;
  });

const envoisDe = async (db: pg.PoolClient, qui: string) =>
  (
    await db.query<{ id: string; code: string; canal: string }>(
      // Un doublon s'inscrit aussi, mais abandonné : seul ce qui est décidé compte.
      `select id, code, canal from notif.envois
        where destinataire = $1 and code like 'impaye.%' and decision = 'a_remettre'`,
      [qui],
    )
  ).rows;

describe("les relances d'impayé partent", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("fermées par défaut : rien n'est posé", async () => {
    await aBlanc(async (db) => {
      // Une décision antérieure de la base locale ne compte pas ici.
      const d = await unImpaye(db, "suspension");
      await regler(db, d.operateur, false, false);
      assert.equal((await relancer(db))["actives"], false);
      assert.equal((await envoisDe(db, d.titulaire)).length, 0);
    });
  });

  it("ouvertes : une relance par facture et par palier, jamais deux ; licence intacte", async () => {
    await aBlanc(async (db) => {
      const d = await unImpaye(db, "suspension");
      const a = await db.query<{ palier: string }>(
        "select palier from facturation.a_relancer_v where facture_id = $1",
        [d.facture],
      );
      assert.equal(a.rows[0]?.palier, "suspension", "la facture est au dernier palier");
      await regler(db, d.operateur, true, false);
      await relancer(db);
      const envois = await envoisDe(db, d.titulaire);
      assert.deepEqual(
        envois.map((e) => [e.code, e.canal]),
        [["impaye.suspension", "email"]],
      );
      await relancer(db);
      assert.equal((await envoisDe(db, d.titulaire)).length, 1, "le second passage se tait");
      const l = await db.query<{ statut: string }>(
        "select statut from facturation.licences where id = $1",
        [d.licence],
      );
      assert.equal(l.rows[0]!.statut, "active", "sans suspension automatique, la tour décide");
    });
  });

  it("la suspension automatique suspend la licence et le trace sans opérateur", async () => {
    await aBlanc(async (db) => {
      const d = await unImpaye(db, "suspension");
      await regler(db, d.operateur, true, true);
      const r = await relancer(db);
      assert.ok(Number(r["suspendues"]) >= 1);
      const l = await db.query<{ statut: string; motif_suspension: string }>(
        "select statut, motif_suspension from facturation.licences where id = $1",
        [d.licence],
      );
      assert.deepEqual(l.rows[0], { statut: "suspendue", motif_suspension: "impaye" });
      const i = await db.query<{ operateur: string | null }>(
        "select operateur from plateforme.interventions where licence_id = $1 and acte = 'suspension'",
        [d.licence],
      );
      assert.equal(i.rows.length, 1);
      assert.equal(i.rows[0]!.operateur, null);
    });
  });

  it("la suspension automatique ne s'ouvre pas sans les relances", async () => {
    await aBlanc(async (db) => {
      const d = await unImpaye(db, "rappel");
      await assert.rejects(regler(db, d.operateur, false, true), /relances_suspension_si_actives/);
    });
  });

  it("le travailleur lit le courriel à remettre, rendu, puis ne le relit plus", async () => {
    await aBlanc(async (db) => {
      const d = await unImpaye(db, "suspension");
      await regler(db, d.operateur, true, false);
      await relancer(db);
      const lire = () =>
        sous(db, "malica_api", null, async () => {
          const { rows } = await db.query<{
            envoi_id: string;
            email: string;
            titre: string;
            corps: string;
            action_route: string | null;
          }>("select * from notif.courriels_a_remettre(500)");
          return rows.filter((c) => c.email === `${d.titulaire}@essai.local`);
        });
      const avant = await lire();
      assert.equal(avant.length, 1);
      assert.ok(avant[0]!.titre.length > 0 && !avant[0]!.corps.includes("{{"), "jetons rendus");
      await sous(db, "malica_api", null, () =>
        db.query("select notif.remettre($1, 'remis')", [avant[0]!.envoi_id]),
      );
      assert.equal((await lire()).length, 0);
    });
  });

  it("aucun compte n'appelle l'ordonnanceur ni la file des courriels", async () => {
    await aBlanc(async (db) => {
      const d = await unImpaye(db, "rappel");
      await assert.rejects(
        sous(db, "authenticated", d.titulaire, () =>
          db.query("select notif.relancer_les_impayes()"),
        ),
        /permission denied/,
      );
      await assert.rejects(
        sous(db, "authenticated", d.titulaire, () =>
          db.query("select * from notif.courriels_a_remettre(1)"),
        ),
        /permission denied/,
      );
      await assert.rejects(
        sous(db, "authenticated", d.titulaire, () =>
          db.query("select plateforme.relances_regler(true, false, 'non')"),
        ),
        /reserve aux operateurs/,
      );
    });
  });
});
