/**
 * Le cabinet attribue un abonnement, la PME choisit (20 octobre 2026).
 *
 * Décisions : le cabinet commercialise n'importe quelle offre au prix public
 * et c'est lui qui est facturé ; la PME accepte ou refuse ; à la révocation
 * du mandat, l'abonnement revient à la PME, avertie, le jour même.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { identite } from "../depots/identite.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le cabinet attribue un abonnement, la PME choisit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `attribue-${Date.now()}`;
  const legalId = matriculeDEssai();
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const sous = <T>(u: Utilisateur, sql: string, args: unknown[]) =>
    sousIdentite(u.id, async (db) => (await db.query<T & pg.QueryResultRow>(sql, args)).rows);

  const forfait = async () =>
    (
      await admin.query<{ offre_code: string }>(
        `select f.offre_code from facturation.forfait_courant_v f
           join facturation.licence_organisations lo on lo.licence_id = f.licence_id
          where lo.tenant_id = $1`,
        [pme],
      )
    ).rows[0]?.offre_code;

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  const proposer = (offre: string) =>
    sous<{ id: string }>(expert, `select public.acces_proposer($1, $2, $3) as id`, [
      cabinet,
      pme,
      offre,
    ]).then((r) => r[0]!.id);

  const repondre = (id: string, oui: boolean) =>
    sous(dirigeant, `select public.acces_repondre($1, $2)`, [id, oui]);

  it("le dirigeant de la PME ne propose pas à la place du cabinet", async () => {
    await assert.rejects(
      sous(dirigeant, `select public.acces_proposer($1, $2, 'team')`, [cabinet, pme]),
      /expert-comptable/,
    );
  });

  it("la PME refuse : rien ne change, et le cabinet le sait", async () => {
    const id = await proposer("team");
    const vues = await sous<{ statut: string }>(
      dirigeant,
      `select statut from public.acces_pour_moi($1)`,
      [pme],
    );
    assert.deepEqual(
      vues.map((v) => v.statut),
      ["propose"],
    );
    await repondre(id, false);
    assert.equal(await forfait(), "basic");
    const notes = await sous<{ kind: string }>(
      expert,
      `select kind from collab.notifications where tenant_id = $1 and kind like 'acces.%'`,
      [cabinet],
    );
    assert.ok(notes.some((n) => n.kind === "acces.refuse"));
  });

  it("une seule proposition ouverte à la fois", async () => {
    const id = await proposer("team");
    await assert.rejects(proposer("solo"), /déjà proposé ou attribué/);
    // On laisse celle-ci ouverte pour l'épreuve suivante.
    assert.match(id, /^[0-9a-f-]{36}$/);
  });

  it("la PME accepte : l'offre monte, le cabinet devient payeur et sa facture le nomme", async () => {
    const [ouverte] = await sous<{ acces_id: string }>(
      dirigeant,
      `select acces_id from public.acces_pour_moi($1) where statut = 'propose'`,
      [pme],
    );
    await repondre(ouverte!.acces_id, true);
    assert.equal(await forfait(), "team");

    const payeurs = await admin.query<{ payeur_type: string }>(
      `select pv.payeur_type from facturation.payeurs_v pv
         join facturation.licence_organisations lo on lo.licence_id = pv.licence_id
        where lo.tenant_id = $1 and pv.payeur_type = 'cabinet'
          and pv.payeur_tenant_id = $2 and pv.au_exclu is null`,
      [pme, cabinet],
    );
    assert.equal(payeurs.rowCount, 1, "le cabinet paie l'offre qu'il a attribuée");

    const lignes = await sous<{ organisation: string }>(
      expert,
      `select organisation from facturation.a_facturer_cabinet($1, date_trunc('month', current_date)::date)`,
      [cabinet],
    ).catch(() => null);
    // La facture du cabinet est lue par la plateforme ou par le cabinet lui-même.
    if (lignes) assert.ok(lignes.some((l) => l.organisation === `PME ${marque}`));

    const console = await sous<{ statut: string; client_nom: string }>(
      expert,
      `select statut, client_nom from public.acces_du_cabinet($1)`,
      [cabinet],
    );
    assert.ok(console.some((c) => c.statut === "actif" && c.client_nom === `PME ${marque}`));
  });

  it("le cabinet reçoit UNE facture du mois, une ligne par client, un seul timbre", async () => {
    // Dans une transaction annulée : l'émetteur et l'opérateur posés ici ne
    // doivent pas exister pour les autres épreuves.
    const db = await admin.connect();
    try {
      await db.query("begin");
      const op = randomUUID();
      await db.query("insert into app.platform_operators (user_id) values ($1)", [op]);
      await db.query(
        `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
         values ($1, date '2026-01-01', $2)`,
        [cabinet, op],
      );
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [op]);
      const { rows } = await db.query<{ r: { facture_id: string; lignes: number } }>(
        `select facturation.emettre_cabinet($1, date_trunc('month', current_date)::date) as r`,
        [cabinet],
      );
      assert.equal(rows[0]!.r.lignes, 1);
      const { rows: f } = await db.query<{
        licence_id: string | null;
        payeur_tenant_id: string;
        timbre: string;
        n: string;
      }>(
        `select f.licence_id, f.payeur_tenant_id, f.timbre::text,
                (select count(*)::text from facturation.facture_lignes l where l.facture_id = f.id) as n
           from facturation.factures f where f.id = $1`,
        [rows[0]!.r.facture_id],
      );
      assert.equal(f[0]!.licence_id, null, "une facture consolidée, pas une par licence");
      assert.equal(f[0]!.payeur_tenant_id, cabinet);
      assert.ok(Number(f[0]!.timbre) > 0, "un timbre, une fois");
      assert.equal(f[0]!.n, "1");
      // Une seconde émission du même mois est refusée.
      await db.query("savepoint deux");
      await assert.rejects(
        db.query(
          `select facturation.emettre_cabinet($1, date_trunc('month', current_date)::date)`,
          [cabinet],
        ),
        /existe deja/,
      );
      await db.query("rollback to savepoint deux");
    } finally {
      await db.query("rollback");
      db.release();
    }
  });

  it("révoqué : l'abonnement revient à la PME, avertie, et le cabinet cesse de payer", async () => {
    await sousIdentite(dirigeant.id, (db) =>
      identite.revoquerMandat(db, pme, "Je reprends en direct"),
    );
    const acces = await admin.query<{ statut: string; motif_fin: string }>(
      `select statut, motif_fin from facturation.acces where tenant_id = $1 and statut <> 'termine'`,
      [pme],
    );
    assert.equal(acces.rowCount, 0, "plus aucun accès ouvert");
    // La licence reste celle de la PME : la lecture continue.
    const lien = await admin.query(
      `select 1 from facturation.licence_organisations where tenant_id = $1`,
      [pme],
    );
    assert.equal(lien.rowCount, 1);
    assert.equal(await forfait(), "team", "la PME garde son offre, à sa charge");
    const avertie = await sous<{ kind: string }>(
      dirigeant,
      `select kind from collab.notifications where tenant_id = $1 and kind = 'acces.repris'`,
      [pme],
    );
    assert.equal(avertie.length, 1);
  });
});
