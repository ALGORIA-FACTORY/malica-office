/**
 * La facture mensuelle d'un cabinet se paie en ligne (23 octobre 2026).
 *
 * Mêmes décisions que pour le titulaire (lot C) : le reste dû en entier,
 * l'encaissement dès la confirmation du prestataire, la reprise automatique.
 * Le payeur est le cabinet — son expert ou son dirigeant —, et la reprise vaut
 * pour chaque licence que la facture couvre.
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

describe("la facture du cabinet se paie en ligne", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `fac-cab-${Date.now()}`;
  const legalId = matriculeDEssai();
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

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
    // Le cabinet attribue Team ; la PME accepte : le cabinet devient payeur.
    const acces = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select public.acces_proposer($1, $2, 'team') as id",
        [cabinet, pme],
      );
      return rows[0]!.id;
    });
    await sousIdentite(dirigeant.id, (db) =>
      db.query("select public.acces_repondre($1, true)", [acces]),
    );
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

  /** Une transaction annulée : l'émetteur et la facture n'existent que le temps de l'épreuve. */
  async function aBlanc(
    corps: (db: pg.PoolClient, facture: string, licence: string) => Promise<void>,
  ) {
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
      const facture = await sous(db, op, async () => {
        const { rows } = await db.query<{ r: { facture_id: string } }>(
          "select facturation.emettre_cabinet($1, date_trunc('month', current_date)::date) as r",
          [cabinet],
        );
        return rows[0]!.r.facture_id;
      });
      const { rows: l } = await db.query<{ licence_id: string }>(
        "select licence_id from facturation.licence_organisations where tenant_id = $1",
        [pme],
      );
      await corps(db, facture, l[0]!.licence_id);
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

  const preparer = (db: pg.PoolClient, qui: string, facture: string) =>
    sous(db, qui, async () => {
      const { rows } = await db.query<{
        p: { paiement_id: string; montant_ttc: string; payeur_tenant_id: string | null };
      }>("select public.paiement_facture_preparer($1) as p", [facture]);
      return rows[0]!.p;
    });

  const payer = (db: pg.PoolClient, qui: string, paiement: string) =>
    sous(db, qui, async () => {
      await db.query(
        "select public.paiement_inscrire($1, 'lien_cree', 'clictopay', 'CAB-1', 'https://x.tn', '{}', 'visa')",
        [paiement],
      );
      await db.query("select public.paiement_inscrire($1, 'paye', 'clictopay', 'CAB-1')", [
        paiement,
      ]);
    });

  it("l'expert du cabinet paie le reste dû ; il s'inscrit sur la facture", async () => {
    await aBlanc(async (db, facture) => {
      const p = await preparer(db, expert.id, facture);
      assert.equal(p.payeur_tenant_id, cabinet);
      await payer(db, expert.id, p.paiement_id);
      const { rows } = await db.query<{ etat: string }>(
        "select etat from facturation.encours_v where facture_id = $1",
        [facture],
      );
      assert.equal(rows[0]!.etat, "payee");
    });
  });

  it("le dirigeant de la PME cliente ne paie pas la facture du cabinet", async () => {
    await aBlanc(async (db, facture) => {
      await assert.rejects(
        preparer(db, dirigeant.id, facture),
        (e: { code?: string }) => e.code === "42501",
      );
    });
  });

  it("la licence couverte, suspendue pour impayé, reprend au paiement", async () => {
    await aBlanc(async (db, facture, licence) => {
      await db.query(
        `update facturation.factures
            set emise_le = current_date - 30, echeance_le = current_date - 15 where id = $1`,
        [facture],
      );
      await db.query(
        `update facturation.licences
            set statut = 'suspendue', suspendue_le = now(), motif_suspension = 'impaye'
          where id = $1`,
        [licence],
      );
      const p = await preparer(db, expert.id, facture);
      await payer(db, expert.id, p.paiement_id);
      const { rows } = await db.query<{ statut: string }>(
        "select statut from facturation.licences where id = $1",
        [licence],
      );
      assert.equal(rows[0]!.statut, "active");
    });
  });
});
