/**
 * Une facture du mois se paie en ligne (23 octobre 2026).
 *
 * Décisions de Wissem : le reste dû, en entier ; inscrit sur la facture dès la
 * confirmation du prestataire ; une licence suspendue pour impayé reprend
 * d'elle-même quand plus aucune facture n'est en retard. Les montants se
 * lisent dans la base ; rien n'est écrit ici. Tout se passe dans une
 * transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { facturation } from "../depots/facturation.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

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

/** Une PME sur Solo, son émetteur, et la facture du mois émise. */
async function uneFacture(db: pg.PoolClient) {
  const principal = randomUUID();
  const operateur = randomUUID();
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const o = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Facture d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = o.rows[0]!.id;
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, principal],
  );
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, 'Essai')", [
    principal,
  ]);
  const l = await db.query<{ id: string }>(
    `insert into facturation.licences (titulaire, offre_code, offre_depuis)
     values ($1, 'solo', current_date) returning id`,
    [principal],
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
  const r = await sous(db, operateur, async () => {
    const { rows } = await db.query<{ r: { factures: Array<{ facture_id: string }> } }>(
      "select facturation.emettre($1, $2::date) as r",
      [licence, periode.rows[0]!.p],
    );
    return rows[0]!.r;
  });
  return { principal, operateur, licence, facture: r.factures[0]!.facture_id };
}

type Paiement = { paiement_id: string; montant_ttc: string; etat: string; objet: string };

const preparer = (db: pg.PoolClient, qui: string, facture: string) =>
  sous(db, qui, async () => {
    const { rows } = await db.query<{ p: Paiement }>(
      "select public.paiement_facture_preparer($1) as p",
      [facture],
    );
    return rows[0]!.p;
  });

const lienPuisPaye = (db: pg.PoolClient, qui: string, paiement: string, prestataire: string) =>
  sous(db, qui, async () => {
    if (prestataire === "simulateur") {
      await db.query("select set_config('malica.paiement_simulateur', 'oui', true)");
    }
    await db.query(
      "select public.paiement_inscrire($1, 'lien_cree', $2, 'REF-9', 'https://x.tn', '{}', 'visa')",
      [paiement, prestataire],
    );
    await db.query("select public.paiement_inscrire($1, 'paye', $2, 'REF-9')", [
      paiement,
      prestataire,
    ]);
  });

const encours = async (db: pg.PoolClient, facture: string) =>
  (
    await db.query<{ etat: string; reste_du: string }>(
      "select etat, reste_du::text from facturation.encours_v where facture_id = $1",
      [facture],
    )
  ).rows[0]!;

describe("une facture se paie en ligne", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("le reste dû, en entier ; préparer deux fois rend le même paiement", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      const p = await preparer(db, d.principal, d.facture);
      assert.equal(p.objet, "facture");
      assert.equal(Number(p.montant_ttc), Number((await encours(db, d.facture)).reste_du));
      const encore = await preparer(db, d.principal, d.facture);
      assert.equal(encore.paiement_id, p.paiement_id);
    });
  });

  it("payé chez un prestataire réel, il s'inscrit sur la facture, tout de suite, une fois", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      const p = await preparer(db, d.principal, d.facture);
      await lienPuisPaye(db, d.principal, p.paiement_id, "clictopay");
      const enc = await db.query<{ montant: string; moyen: string }>(
        "select montant::text, moyen from facturation.encaissements where facture_id = $1",
        [d.facture],
      );
      assert.equal(enc.rows.length, 1);
      assert.equal(Number(enc.rows[0]!.montant), Number(p.montant_ttc));
      assert.equal(enc.rows[0]!.moyen, "carte");
      assert.equal((await encours(db, d.facture)).etat, "payee");
      await assert.rejects(
        preparer(db, d.principal, d.facture),
        /paiement\.facture_rien_a_regler/,
        "une facture payée ne se repaie pas",
      );
      const mes = await sous(db, d.principal, () => facturation.mesFactures(db));
      assert.equal(mes.find((f) => f["facture_id"] === d.facture)?.["etat"], "payee");
    });
  });

  it("un « payé » du simulateur ne fait entrer aucun argent : la facture reste due", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      const p = await preparer(db, d.principal, d.facture);
      await lienPuisPaye(db, d.principal, p.paiement_id, "simulateur");
      assert.notEqual((await encours(db, d.facture)).etat, "payee");
    });
  });

  it("un encaissement saisi entre-temps rend le montant périmé : pas de lien, un nouveau paiement", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      const p = await preparer(db, d.principal, d.facture);
      await db.query(
        `insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le, saisi_par)
         values ($1, 1, 'virement', 'acompte manuel', current_date, $2)`,
        [d.facture, d.operateur],
      );
      await assert.rejects(
        sous(db, d.principal, () =>
          db.query(
            "select public.paiement_inscrire($1, 'lien_cree', 'clictopay', 'R', 'https://x', '{}', 'visa')",
            [p.paiement_id],
          ),
        ),
        /paiement\.montant_perime/,
      );
      const neuf = await preparer(db, d.principal, d.facture);
      assert.notEqual(neuf.paiement_id, p.paiement_id);
      assert.equal(Number(neuf.montant_ttc), Number(p.montant_ttc) - 1);
    });
  });

  it("une licence transmise après l'émission reste payable par son nouveau titulaire", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      const repreneur = randomUUID();
      // La transmission, comme `public.licence_transmettre` la déclare : le
      // repreneur tient la licence et la place de dirigeant.
      await db.query("select set_config('facturation.transmission', $1, true)", [d.licence]);
      await db.query("update facturation.licences set titulaire = $2 where id = $1", [
        d.licence,
        repreneur,
      ]);
      await db.query("update identity.memberships set user_id = $2 where user_id = $1", [
        d.principal,
        repreneur,
      ]);
      const p = await preparer(db, repreneur, d.facture);
      assert.equal(p.objet, "facture");
      await assert.rejects(
        preparer(db, d.principal, d.facture),
        (e: { code?: string }) => e.code === "42501",
        "l'ancien titulaire ne tient plus la licence",
      );
    });
  });

  it("un autre que le payeur ne prépare rien", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      await assert.rejects(
        preparer(db, randomUUID(), d.facture),
        (e: { code?: string }) => e.code === "42501",
      );
    });
  });

  it("suspendue pour impayé, la licence reprend quand plus aucune facture n'est en retard", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      await db.query(
        `update facturation.factures
            set emise_le = current_date - 30, echeance_le = current_date - 15 where id = $1`,
        [d.facture],
      );
      await db.query(
        `update facturation.licences
            set statut = 'suspendue', suspendue_le = now(), motif_suspension = 'impaye'
          where id = $1`,
        [d.licence],
      );
      assert.equal((await encours(db, d.facture)).etat, "en_retard");
      const p = await preparer(db, d.principal, d.facture);
      await lienPuisPaye(db, d.principal, p.paiement_id, "clictopay");
      const l = await db.query<{ statut: string; motif_suspension: string | null }>(
        "select statut, motif_suspension from facturation.licences where id = $1",
        [d.licence],
      );
      assert.deepEqual(l.rows[0], { statut: "active", motif_suspension: null });
      const trace = await db.query(
        "select 1 from plateforme.interventions where licence_id = $1 and acte = 'reprise'",
        [d.licence],
      );
      assert.equal(trace.rows.length, 1, "la reprise est tracée");
    });
  });

  it("une suspension pour un autre motif ne se lève pas par un paiement", async () => {
    await aBlanc(async (db) => {
      const d = await uneFacture(db);
      await db.query(
        `update facturation.licences
            set statut = 'suspendue', suspendue_le = now(), motif_suspension = 'demande_client'
          where id = $1`,
        [d.licence],
      );
      const p = await preparer(db, d.principal, d.facture);
      await lienPuisPaye(db, d.principal, p.paiement_id, "clictopay");
      const l = await db.query<{ statut: string }>(
        "select statut from facturation.licences where id = $1",
        [d.licence],
      );
      assert.equal(l.rows[0]!.statut, "suspendue");
    });
  });
});
