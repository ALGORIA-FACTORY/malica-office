/**
 * Une montée d'offre se paie en ligne : la différence du mois, TVA comprise,
 * un acompte qui s'impute sur la facture du mois — une fois.
 *
 * Les prix et la TVA se lisent dans la base ; rien n'est écrit ici. Tout se
 * passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Decor {
  licence: string;
  tenant: string;
  principal: string;
  operateur: string;
}

async function decor(db: pg.PoolClient, emetteur = true): Promise<Decor> {
  const principal = randomUUID();
  const operateur = randomUUID();
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const o = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Montée d''essai', 'TN', 'TND') returning id`,
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
  if (emetteur) {
    const e = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', 'ALGORIA Factory d''essai', 'TN', 'TND') returning id`,
    );
    await db.query(
      `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
       values ($1, date '2026-01-01', $2)`,
      [e.rows[0]!.id, operateur],
    );
  }
  return { licence: l.rows[0]!.id, tenant, principal, operateur };
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

type Paiement = {
  paiement_id: string;
  montant_ht: string;
  montant_tva: string;
  montant_ttc: string;
  etat: string;
  impute: boolean;
};

const monter = (db: pg.PoolClient, d: Decor) =>
  sous(db, d.principal, async () => {
    await db.query("select public.forfait_changer('team', $1)", [d.tenant]);
    const { rows } = await db.query<{ p: Paiement | null }>(
      "select public.paiement_montee_preparer($1) as p",
      [d.tenant],
    );
    return rows[0]!.p;
  });

describe("une montée se paie en ligne", { skip: !ADMIN }, () => {
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

  it("la différence du mois, au prorata des jours, TVA comprise, sans timbre", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db);
      const p = await monter(db, d);
      assert.ok(p, "une montée prépare un paiement");

      const attendu = await db.query<{ ht: string }>(
        `select round(((ref.offre_a('team', current_date)).prix_mensuel_ht
                     - (ref.offre_a('solo', current_date)).prix_mensuel_ht)
                     * (extract(day from date_trunc('month', current_date) + interval '1 month'
                                - interval '1 day') - extract(day from current_date) + 1)
                     / extract(day from date_trunc('month', current_date) + interval '1 month'
                               - interval '1 day'), 3)::text as ht`,
      );
      assert.equal(Number(p.montant_ht), Number(attendu.rows[0]!.ht));
      assert.ok(Number(p.montant_tva) > 0, "la TVA vient du pack de l'émetteur");
      assert.equal(
        Number(p.montant_ttc),
        // Au millime : la somme de deux flottants n'est pas un montant
        // (le 21 octobre, 6,334 donnait 6,3340000000000005).
        Math.round((Number(p.montant_ht) + Number(p.montant_tva)) * 1000) / 1000,
        "pas de timbre : il est sur la facture",
      );
      assert.equal(p.etat, "a_payer");

      const encore = await sous(db, d.principal, async () => {
        const { rows } = await db.query<{ p: Paiement }>(
          "select public.paiement_montee_preparer($1) as p",
          [d.tenant],
        );
        return rows[0]!.p;
      });
      assert.equal(encore.paiement_id, p.paiement_id, "préparer deux fois rend le même paiement");
    });
  });

  it("sans émetteur désigné, rien ne se prépare : l'offre s'ouvre quand même", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, false);
      assert.equal(await monter(db, d), null);
      const f = await db.query<{ offre_code: string }>(
        "select offre_code from facturation.forfait_courant_v where licence_id = $1",
        [d.licence],
      );
      assert.equal(f.rows[0]!.offre_code, "team");
    });
  });

  it("le simulateur n'est admis que déclaré, et un paiement ne se paie qu'une fois", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db);
      const p = (await monter(db, d))!;
      const inscrire = () =>
        db.query("select public.paiement_inscrire($1, 'paye', 'simulateur', 'sim-1')", [
          p.paiement_id,
        ]);

      await assert.rejects(
        sous(db, d.principal, inscrire),
        (e: { code?: string }) => e.code === "42501",
        "le simulateur non déclaré est refusé par la base",
      );
      await sous(db, d.principal, async () => {
        await db.query("select set_config('malica.paiement_simulateur', 'oui', true)");
        await inscrire();
        await inscrire();
      });
      const n = await db.query(
        "select 1 from facturation.paiement_evenements where paiement_id = $1 and etat = 'paye'",
        [p.paiement_id],
      );
      assert.equal(n.rows.length, 1, "payé une fois, jamais deux");
    });
  });

  it("un autre que le principal ne prépare ni n'inscrit rien", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db);
      const p = (await monter(db, d))!;
      const proprietaire = randomUUID();
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
        [d.tenant, proprietaire],
      );
      await assert.rejects(
        sous(db, proprietaire, () =>
          db.query("select public.paiement_montee_preparer($1)", [d.tenant]),
        ),
        (e: { code?: string }) => e.code === "42501",
      );
      await assert.rejects(
        sous(db, proprietaire, () =>
          db.query("select public.paiement_inscrire($1, 'paye', 'clictopay', 'x')", [
            p.paiement_id,
          ]),
        ),
        (e: { code?: string }) => e.code === "42501",
      );
    });
  });

  it("un « payé » du simulateur ne fait entrer aucun argent : rien ne s'impute", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db);
      const p = (await monter(db, d))!;
      await sous(db, d.principal, async () => {
        await db.query("select set_config('malica.paiement_simulateur', 'oui', true)");
        await db.query("select public.paiement_inscrire($1, 'paye', 'simulateur', 'sim-1')", [
          p.paiement_id,
        ]);
      });
      const periode = await db.query<{ p: string }>(
        "select to_char(date_trunc('month', current_date), 'YYYY-MM-DD') as p",
      );
      const f = await sous(db, d.operateur, async () => {
        const { rows } = await db.query<{ r: { factures: Array<{ facture_id: string }> } }>(
          "select facturation.emettre($1, $2::date) as r",
          [d.licence, periode.rows[0]!.p],
        );
        return rows[0]!.r;
      });
      const enc = await db.query("select 1 from facturation.encaissements where facture_id = $1", [
        f.factures[0]!.facture_id,
      ]);
      assert.equal(enc.rows.length, 0, "la facture reste due en entier");
    });
  });

  it("payé, il s'impute sur la facture du mois comme encaissement par carte, une fois", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db);
      const p = (await monter(db, d))!;
      await sous(db, d.principal, () =>
        db.query("select public.paiement_inscrire($1, 'paye', 'clictopay', 'CTP-42')", [
          p.paiement_id,
        ]),
      );

      const periode = await db.query<{ p: string }>(
        "select to_char(date_trunc('month', current_date), 'YYYY-MM-DD') as p",
      );
      const f = await sous(db, d.operateur, async () => {
        const { rows } = await db.query<{ r: { factures: Array<{ facture_id: string }> } }>(
          "select facturation.emettre($1, $2::date) as r",
          [d.licence, periode.rows[0]!.p],
        );
        return rows[0]!.r;
      });
      const facture = f.factures[0]!.facture_id;
      const enc = await db.query<{ montant: string; moyen: string; reference: string }>(
        "select montant, moyen, reference from facturation.encaissements where facture_id = $1",
        [facture],
      );
      assert.equal(enc.rows.length, 1);
      assert.equal(enc.rows[0]!.moyen, "carte");
      assert.equal(Number(enc.rows[0]!.montant), Number(p.montant_ttc));
      assert.match(enc.rows[0]!.reference, /CTP-42/);

      const v = await db.query<{ impute: boolean }>(
        "select impute from facturation.paiements_en_ligne_v where paiement_id = $1",
        [p.paiement_id],
      );
      assert.equal(v.rows[0]!.impute, true);
    });
  });
});
