/**
 * Les moyens de paiement en ligne vivent en table (22 octobre 2026).
 *
 * « Sans hardcoding, sans doublons, sans résidus, et tout dans les tables. »
 * Les prestataires, les moyens (Visa, Mastercard, D17), ce que chacun accepte,
 * la devise et son exposant sont des LIGNES ; le code ne garde que les
 * adaptateurs. Ces épreuves tiennent le référentiel, la page de choix et
 * l'inscription d'un lien pour un moyen. Tout se passe dans une transaction
 * annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { after, describe, it } from "node:test";

import pg from "pg";

import { facturation } from "../depots/facturation.ts";
import { ADAPTATEURS } from "../paiement/prestataires.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;
const PUBLIC = new URL("../../../web/public", import.meta.url);

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

/** Une PME sur Solo qui monte sur Team : un paiement à régler. */
async function unPaiement(db: pg.PoolClient) {
  const principal = randomUUID();
  const operateur = randomUUID();
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const o = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Moyens d''essai', 'TN', 'TND') returning id`,
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
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [l.rows[0]!.id, tenant],
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
  const p = await sous(db, principal, async () => {
    await db.query("select public.forfait_changer('team', $1)", [tenant]);
    const { rows } = await db.query<{ p: { paiement_id: string } }>(
      "select public.paiement_montee_preparer($1) as p",
      [tenant],
    );
    return rows[0]!.p;
  });
  return { principal, operateur, licence: l.rows[0]!.id, paiement: p.paiement_id };
}

const lien = (db: pg.PoolClient, paiement: string, prestataire: string, moyen: string | null) =>
  db.query(
    `select public.paiement_inscrire($1, 'lien_cree', $2, 'REF-1', 'https://x.tn/pay', '{}', $3)`,
    [paiement, prestataire, moyen],
  );

describe("les moyens de paiement vivent en table", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("le référentiel : Visa et Mastercard actifs, D17 inscrit mais inactif, tout traduit, tout illustré", async () => {
    await aBlanc(async (db) => {
      const { rows } = await db.query<{ code: string; actif: boolean; logo: string }>(
        "select code, actif, logo from facturation.moyens_paiement_v order by rang",
      );
      assert.deepEqual(
        rows.map((m) => [m.code, m.actif]),
        [
          ["visa", true],
          ["mastercard", true],
          ["d17", false],
        ],
      );
      for (const m of rows) {
        assert.ok(existsSync(new URL(`.${m.logo}`, `${PUBLIC}/`)), `logo servi : ${m.logo}`);
      }
      const p = await db.query<{ logo: string }>(
        "select logo from facturation.prestataires_paiement where logo is not null",
      );
      for (const x of p.rows) assert.ok(existsSync(new URL(`.${x.logo}`, `${PUBLIC}/`)), x.logo);

      const manquants = await db.query(
        `select ns, key, locale from (
           select 'moyen_en_ligne' as ns, code as key from facturation.moyens_paiement
           union all
           select 'prestataire_paiement', code from facturation.prestataires_paiement) c
         cross join (values ('fr'), ('en'), ('ar')) l(locale)
         where not exists (select 1 from ref.labels r
                            where r.ns = c.ns and r.key = c.key and r.locale = l.locale)`,
      );
      assert.deepEqual(manquants.rows, [], "chaque nom existe en fr, en, ar");
    });
  });

  it("chaque adaptateur de la table a son code, et rien d'autre n'en a", async () => {
    await aBlanc(async (db) => {
      const { rows } = await db.query<{ adaptateur: string }>(
        "select distinct adaptateur from facturation.prestataires_paiement where adaptateur is not null",
      );
      assert.deepEqual(rows.map((r) => r.adaptateur).sort(), Object.keys(ADAPTATEURS).sort());
    });
  });

  it("un lien se crée pour un moyen actif que le prestataire accepte, et l'événement le garde", async () => {
    await aBlanc(async (db) => {
      const d = await unPaiement(db);
      await assert.rejects(
        sous(db, d.principal, () => lien(db, d.paiement, "clictopay", "d17")),
        /paiement\.moyen_indisponible/,
        "D17 est inactif",
      );
      await assert.rejects(
        sous(db, d.principal, () => lien(db, d.paiement, "clictopay", null)),
        /paiement\.moyen_indisponible/,
        "sans moyen, pas de lien",
      );
      await assert.rejects(
        sous(db, d.principal, () => lien(db, d.paiement, "aucun", "visa")),
        (e: { code?: string }) => e.code === "23514",
        "un prestataire qui n'ouvre rien n'inscrit rien",
      );
      await sous(db, d.principal, () => lien(db, d.paiement, "clictopay", "visa"));
      const e = await db.query<{ moyen: string }>(
        "select moyen from facturation.paiement_evenements where paiement_id = $1",
        [d.paiement],
      );
      assert.deepEqual(
        e.rows.map((r) => r.moyen),
        ["visa"],
      );
    });
  });

  it("payé, la facture inscrit le moyen d'encaissement du moyen choisi", async () => {
    await aBlanc(async (db) => {
      const d = await unPaiement(db);
      await sous(db, d.principal, async () => {
        await lien(db, d.paiement, "clictopay", "mastercard");
        await db.query("select public.paiement_inscrire($1, 'paye', 'clictopay', 'REF-1')", [
          d.paiement,
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
      const enc = await db.query<{ moyen: string }>(
        "select moyen from facturation.encaissements where facture_id = $1",
        [f.factures[0]!.facture_id],
      );
      const attendu = await db.query<{ m: string }>(
        "select moyen_encaissement as m from facturation.moyens_paiement where code = 'mastercard'",
      );
      assert.deepEqual(
        enc.rows.map((r) => r.moyen),
        [attendu.rows[0]!.m],
      );
    });
  });

  it("un moyen ne s'active pas sans dire comment il s'encaisse", async () => {
    await aBlanc(async (db) => {
      await assert.rejects(
        db.query(
          "insert into facturation.moyens_paiement_etats (moyen, actif, motif) values ('d17', true, 'essai')",
        ),
        /moyen d'encaissement/,
      );
    });
  });

  it("la page de choix : noms traduits, payable si actif et accepté par le prestataire en service", async () => {
    await aBlanc(async (db) => {
      const d = await unPaiement(db);
      await sous(db, d.operateur, () =>
        db.query(
          "select plateforme.paiement_regler('simulateur', null, 'https://staging.exemple.tn', 'essai')",
        ),
      );
      const r = await sous(db, d.principal, () => facturation.moyensDePaiementEnLigne(db, "ar"));
      assert.equal(r.prestataire?.code, "simulateur");
      const parCode = Object.fromEntries(r.moyens.map((m) => [m["code"], m]));
      assert.equal(parCode["visa"]!["accepte"], true);
      assert.equal(parCode["visa"]!["actif"], true);
      assert.equal(parCode["d17"]!["actif"], false);
      assert.equal(parCode["d17"]!["accepte"], false);
      assert.equal(parCode["d17"]!["libelle"], "D17 — البريد التونسي");
    });
  });

  it("paiement fermé : aucun prestataire, aucun moyen payable", async () => {
    // Une autre transaction : deux réglages d'une même transaction auraient la
    // même date, et « la dernière décision » ne se départagerait pas.
    await aBlanc(async (db) => {
      const d = await unPaiement(db);
      await sous(db, d.operateur, () =>
        db.query("select plateforme.paiement_regler('aucun', null, null, 'fermé')"),
      );
      const ferme = await sous(db, d.principal, () => facturation.moyensDePaiementEnLigne(db, "fr"));
      assert.equal(ferme.prestataire, null, "paiement fermé : aucun prestataire");
      assert.ok(ferme.moyens.every((m) => m["accepte"] === false));
    });
  });
});
