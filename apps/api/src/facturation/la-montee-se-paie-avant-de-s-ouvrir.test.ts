/**
 * La montée se paie avant de s'ouvrir (décision du 22 novembre 2026).
 *
 * L'oracle est écrit à partir de la décision, pas de la fonction :
 *
 *   - une montée que la société paie elle-même ne change pas l'offre : elle
 *     rend un paiement à régler, et l'offre reste celle d'avant ;
 *   - le paiement confirmé ouvre l'offre demandée, et ne se repaie pas ;
 *   - sans paiement possible (aucun émetteur), la montée est refusée ;
 *   - une descente s'applique tout de suite, comme avant.
 *
 * Tout se passe dans une transaction annulée.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { decor, enPersonne, ouvrirLePerimetrePme, regler, type Decor } from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Demande {
  change: boolean;
  paiement: { paiement_id: string; objet: string; etat: string; montant_ttc: string } | null;
}

const demander = (db: pg.PoolClient, d: Decor, offre: string) =>
  enPersonne(db, d.titulaire, async () => {
    const { rows } = await db.query<{ r: Demande }>("select public.forfait_demander($1, $2) as r", [
      offre,
      d.tenant,
    ]);
    return rows[0]!.r;
  });

const offreCourante = async (db: pg.PoolClient, d: Decor) =>
  (
    await db.query<{ offre_code: string }>(
      "select offre_code from facturation.forfait_courant_v where licence_id = $1",
      [d.licence],
    )
  ).rows[0]!.offre_code;

describe("la montée se paie avant de s'ouvrir", { skip: !ADMIN }, () => {
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

  it("la montée rend un paiement à régler, et l'offre ne bouge pas", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const r = await demander(db, d, "team");
      assert.equal(r.change, false);
      assert.equal(r.paiement?.objet, "montee_demandee");
      assert.equal(r.paiement?.etat, "a_payer");
      assert.ok(Number(r.paiement?.montant_ttc) > 0);
      assert.equal(await offreCourante(db, d), "solo", "rien ne s'ouvre avant le paiement");
    });
  });

  it("la même demande, encore à payer, rend le même paiement", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const a = await demander(db, d, "team");
      const b = await demander(db, d, "team");
      assert.equal(b.paiement?.paiement_id, a.paiement?.paiement_id);
    });
  });

  it("le paiement confirmé ouvre l'offre, et elle ne se repaie pas", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const r = await demander(db, d, "team");
      await regler(db, d, r.paiement!.paiement_id);
      assert.equal(await offreCourante(db, d), "team");
      const { rows: ouverte } = await db.query<{ forfait_id: string | null; refus: string | null }>(
        `select o.forfait_id, o.refus from facturation.montees_ouvertes o
           join facturation.paiements_en_ligne p on p.montee_demandee_id = o.montee_id
          where p.id = $1`,
        [r.paiement!.paiement_id],
      );
      assert.equal(ouverte[0]?.refus, null);
      assert.ok(ouverte[0]?.forfait_id);
      // Relue par la préparation d'une montée, elle rend le paiement déjà réglé.
      const relue = await enPersonne(db, d.titulaire, async () => {
        const { rows } = await db.query<{ p: { paiement_id: string; etat: string } | null }>(
          "select public.paiement_montee_preparer($1) as p",
          [d.tenant],
        );
        return rows[0]!.p;
      });
      assert.equal(relue?.paiement_id, r.paiement!.paiement_id);
      assert.equal(relue?.etat, "paye");
      const { rows: n } = await db.query<{ n: number }>(
        "select count(*)::int as n from facturation.paiements_en_ligne where licence_id = $1",
        [d.licence],
      );
      assert.equal(n[0]!.n, 1, "un seul paiement pour la montée");
    });
  });

  it("une demande remplacée par une autre ne se paie plus", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const a = await demander(db, d, "team");
      await demander(db, d, "premium");
      const { rows } = await db.query<{ etat: string }>(
        "select etat from facturation.paiements_en_ligne_v where paiement_id = $1",
        [a.paiement!.paiement_id],
      );
      assert.equal(rows[0]!.etat, "remplace");
    });
  });

  it("sans paiement possible, la montée est refusée et l'offre reste", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      await db.query("set local session_replication_role = replica");
      await db.query("delete from facturation.emetteurs");
      await db.query("set local session_replication_role = origin");
      await assert.rejects(demander(db, d, "team"), /refus\.forfait\.paiement_indisponible/);
      assert.equal(await offreCourante(db, d), "solo");
    });
  });

  // Pilote, 22 novembre 2026, v0.2.113 : sous la facturation immédiate, la montée passait sans paiement.
  it("sous la facturation immédiate, sans paiement possible, la montée est refusée aussi", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      await ouvrirLePerimetrePme(db, d);
      await db.query("set local session_replication_role = replica");
      await db.query("delete from facturation.emetteurs");
      await db.query("set local session_replication_role = origin");
      await assert.rejects(demander(db, d, "team"), /refus\.forfait\.paiement_indisponible/);
      assert.equal(await offreCourante(db, d), "solo");
    });
  });

  it("une descente s'applique tout de suite", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const r = await demander(db, d, "basic");
      assert.equal(r.change, true);
      assert.equal(r.paiement, null);
      assert.equal(await offreCourante(db, d), "basic");
    });
  });
});
