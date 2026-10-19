/**
 * Les recharges de lectures (décidées le 19 octobre 2026).
 *
 * Quatre paliers, jamais sur le Basic, douze mois de validité, gelées si l'offre
 * courante n'en admet pas ; on prend d'abord le forfait du mois, puis la
 * recharge qui expire la première ; l'automatique achète sous un plafond
 * mensuel ; la facture du mois les porte, sous un seul timbre. Seul le
 * propriétaire principal achète et règle.
 *
 * Les quantités ne sont pas écrites ici : elles se lisent dans la grille.
 * Tout se passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Societe {
  tenant: string;
  licence: string;
  principal: string;
  collaborateur: string;
}

/** Le palier de 5 DT, et le forfait du Solo, tels que la grille les donne. */
let PALIER = { code: "", lectures: 0, prix: 0 };
let SOLO = 0;

async function societe(db: pg.PoolClient, offre: "basic" | "solo" | "team"): Promise<Societe> {
  const principal = randomUUID();
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Recharge d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = org.rows[0]!.id;
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
     values ($1, $2, current_date) returning id`,
    [principal, offre],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [l.rows[0]!.id, tenant],
  );
  let collaborateur = "";
  if (offre === "team") {
    collaborateur = randomUUID();
    await db.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
      [tenant, collaborateur],
    );
  }
  return { tenant, licence: l.rows[0]!.id, principal, collaborateur };
}

async function piece(db: pg.PoolClient, s: Societe, cle: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key, created_by)
     values ($1, 'entite', 'photo', $2, $2, $3) returning id`,
    [s.tenant, `${cle}-${randomUUID()}`, s.principal],
  );
  return rows[0]!.id;
}

/** Remplit le forfait du mois : `n` lectures déjà comptées sur lui. */
async function remplir(db: pg.PoolClient, s: Societe, n: number): Promise<void> {
  await db.query(
    `with neuves as (
       insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key, created_by)
       select $1, 'entite', 'photo', 'r/' || i || '/' || $3, 'r-' || i || '-' || $3, $2
         from generate_series(1, $4::int) as i
       returning id)
     insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
     select $1, $5, id, date_trunc('month', current_date)::date, $2 from neuves`,
    [s.tenant, s.principal, randomUUID(), n, s.licence],
  );
}

async function sous<T>(db: pg.PoolClient, identite: string, corps: () => Promise<T>): Promise<T> {
  await db.query("savepoint sous_role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [identite]);
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

const verdict = (db: pg.PoolClient, qui: string, p: string) =>
  sous(db, qui, async () => {
    const { rows } = await db.query<{ v: Record<string, unknown> }>(
      "select public.lecture_autorisee($1) as v",
      [p],
    );
    return rows[0]!.v;
  });

const consommer = (db: pg.PoolClient, qui: string, p: string) =>
  sous(db, qui, () => db.query("select public.lecture_consommer($1)", [p]));

const acheter = (db: pg.PoolClient, s: Societe, code = PALIER.code) =>
  sous(db, s.principal, async () => {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      "select public.recharge_acheter($1, $2) as r",
      [code, s.tenant],
    );
    return rows[0]!.r;
  });

const code = (attendu: string) => (e: { code?: string }) => e.code === attendu;

describe("les recharges de lectures", { skip: !ADMIN }, () => {
  before(async () => {
    const p = await pool!.query<{ code: string; lectures: number; prix: string }>(
      `select code, lectures, prix_ht as prix from ref.recharges
        where effective_from <= current_date order by rang, effective_from desc limit 1`,
    );
    PALIER = {
      code: p.rows[0]!.code,
      lectures: p.rows[0]!.lectures,
      prix: Number(p.rows[0]!.prix),
    };
    const s = await pool!.query<{ n: number }>(
      "select lectures_par_organisation as n from ref.offre_a('solo', current_date)",
    );
    SOLO = Number(s.rows[0]!.n);
    assert.ok(PALIER.lectures > 1 && SOLO > 1);
  });

  after(async () => {
    await pool?.end();
  });

  async function dansUneTransaction(corps: (db: pg.PoolClient) => Promise<void>): Promise<void> {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      await corps(db);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  it("le Basic n'achète pas de recharge ; le Solo, si, pour douze mois", async () => {
    await dansUneTransaction(async (db) => {
      const basic = await societe(db, "basic");
      await assert.rejects(acheter(db, basic), /recharge_refusee:offre_sans_recharge/);

      const solo = await societe(db, "solo");
      const r = await acheter(db, solo);
      assert.equal(r["restantes"], PALIER.lectures);
      assert.equal(r["utilisable"], true);
      assert.equal(r["origine"], "achat");
      const e = await db.query<{ ok: boolean }>(
        `select expire_le = (achetee_le + interval '12 months')::date as ok
           from facturation.recharges where id = $1`,
        [r["recharge_id"]],
      );
      assert.equal(e.rows[0]!.ok, true);
    });
  });

  it("seul le propriétaire principal achète et règle l'automatique", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "team");
      const proprietaire = randomUUID();
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
        [s.tenant, proprietaire],
      );
      for (const qui of [proprietaire, s.collaborateur, randomUUID()]) {
        await assert.rejects(
          sous(db, qui, () =>
            db.query("select public.recharge_acheter($1, $2)", [PALIER.code, s.tenant]),
          ),
          code("42501"),
        );
        await assert.rejects(
          sous(db, qui, () =>
            db.query("select public.recharge_automatique_regler(true, $1, 50, $2)", [
              PALIER.code,
              s.tenant,
            ]),
          ),
          code("42501"),
        );
      }
      const { rows } = await db.query("select 1 from facturation.recharges where licence_id = $1", [
        s.licence,
      ]);
      assert.equal(rows.length, 0);
    });
  });

  it("le forfait d'abord, la recharge ensuite, et la lecture dit sur quoi elle a été prise", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "solo");
      const r = await acheter(db, s);

      const avant = await piece(db, s, "dans-le-forfait");
      await consommer(db, s.principal, avant);
      const l1 = await db.query<{ recharge_id: string | null }>(
        "select recharge_id from facturation.lectures where piece_id = $1",
        [avant],
      );
      assert.equal(l1.rows[0]!.recharge_id, null, "sous le forfait, la recharge ne bouge pas");

      await remplir(db, s, SOLO - 1);
      const p = await piece(db, s, "sur-recharge");
      const v = await verdict(db, s.principal, p);
      assert.equal(v["autorisee"], true);
      assert.equal(v["motif"], "sur_recharge");
      assert.equal(v["recharge"], PALIER.lectures);

      await consommer(db, s.principal, p);
      const l2 = await db.query<{ recharge_id: string | null }>(
        "select recharge_id from facturation.lectures where piece_id = $1",
        [p],
      );
      assert.equal(l2.rows[0]!.recharge_id, r["recharge_id"]);

      const c = await db.query<{ consommees: number; restantes: number }>(
        `select c.lectures_consommees as consommees, rv.restantes
           from facturation.consommation_v c, facturation.recharges_v rv
          where c.licence_id = $1 and rv.recharge_id = $2`,
        [s.licence, r["recharge_id"]],
      );
      assert.equal(
        c.rows[0]!.consommees,
        SOLO,
        "le forfait n'a pas compté la lecture sur recharge",
      );
      assert.equal(c.rows[0]!.restantes, PALIER.lectures - 1);
    });
  });

  it("on prend la recharge qui expire la première", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "solo");
      const recente = await acheter(db, s);
      const ancienne = await db.query<{ id: string }>(
        `insert into facturation.recharges
           (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
         values ($1, $2, 5, 0, current_date - 300, current_date + 65, 'plateforme', $3)
         returning id`,
        [s.licence, PALIER.code, s.principal],
      );
      await remplir(db, s, SOLO);
      const p = await piece(db, s, "la-premiere-qui-expire");
      await consommer(db, s.principal, p);
      const l = await db.query<{ recharge_id: string }>(
        "select recharge_id from facturation.lectures where piece_id = $1",
        [p],
      );
      assert.equal(l.rows[0]!.recharge_id, ancienne.rows[0]!.id);
      assert.notEqual(l.rows[0]!.recharge_id, recente["recharge_id"]);
    });
  });

  it("sur une offre qui n'en admet pas, la recharge dort : elle ne se lit pas, elle reste", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "basic");
      await db.query(
        `insert into facturation.recharges
           (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
         values ($1, $2, $3, $4, current_date - 10, current_date + 355, 'achat', $5)`,
        [s.licence, PALIER.code, PALIER.lectures, PALIER.prix, s.principal],
      );
      const basic = await db.query<{ n: number }>(
        "select lectures_droit as n from facturation.consommation_v where licence_id = $1",
        [s.licence],
      );
      await remplir(db, s, Number(basic.rows[0]!.n));
      const p = await piece(db, s, "gelee");
      const v = await verdict(db, s.principal, p);
      assert.equal(v["autorisee"], false);
      assert.equal(v["motif"], "plafond_atteint");
      assert.equal(v["gelees"], PALIER.lectures, "la recharge gelée est dite, pas perdue");
    });
  });

  it("l'automatique achète au plafond du forfait, et s'arrête à son plafond du mois", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "solo");
      await sous(db, s.principal, () =>
        db.query("select public.recharge_automatique_regler(true, $1, $2, $3)", [
          PALIER.code,
          PALIER.prix,
          s.tenant,
        ]),
      );
      await remplir(db, s, SOLO);

      const p = await piece(db, s, "auto");
      const v = await verdict(db, s.principal, p);
      assert.equal(v["motif"], "recharge_automatique");
      await consommer(db, s.principal, p);

      const r = await db.query<{ id: string; origine: string; prix_ht: string }>(
        "select id, origine, prix_ht from facturation.recharges where licence_id = $1",
        [s.licence],
      );
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0]!.origine, "automatique");

      // On vide la recharge automatique ; une seconde dépasserait le plafond.
      await db.query(
        `with neuves as (
           insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key, created_by)
           select $1, 'entite', 'photo', 'a/' || i || '/' || $3, 'a-' || i || '-' || $3, $2
             from generate_series(1, $4::int) as i
           returning id)
         insert into facturation.lectures
           (tenant_id, licence_id, piece_id, periode, consommee_par, recharge_id)
         select $1, $5, id, date_trunc('month', current_date)::date, $2, $6 from neuves`,
        [s.tenant, s.principal, randomUUID(), PALIER.lectures - 1, s.licence, r.rows[0]!.id],
      );
      const q = await piece(db, s, "au-dela-du-plafond-du-mois");
      const w = await verdict(db, s.principal, q);
      assert.equal(w["autorisee"], false);
      assert.equal(w["motif"], "plafond_atteint");
    });
  });

  it("la facture du mois porte la recharge, sous un seul timbre, et une seule fois", async () => {
    await dansUneTransaction(async (db) => {
      const s = await societe(db, "solo");
      await acheter(db, s);
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

      const periode = await db.query<{ p: string }>(
        "select to_char(date_trunc('month', current_date), 'YYYY-MM-DD') as p",
      );
      const emettre = () =>
        sous(db, operateur, async () => {
          const { rows } = await db.query<{ r: { factures: Array<{ facture_id: string }> } }>(
            "select facturation.emettre($1, $2::date) as r",
            [s.licence, periode.rows[0]!.p],
          );
          return rows[0]!.r;
        });

      const f = await emettre();
      const id = f.factures[0]!.facture_id;
      const lignes = await db.query<{ libelle: string; montant_ht: string }>(
        "select libelle, montant_ht from facturation.facture_lignes where facture_id = $1 order by ordinal",
        [id],
      );
      assert.equal(lignes.rows.length, 2, "l'abonnement, puis la recharge");
      assert.match(lignes.rows[1]!.libelle, /^Recharge /);
      assert.equal(Number(lignes.rows[1]!.montant_ht), PALIER.prix);

      const facture = await db.query<{ ht: string; timbre: string; somme: string }>(
        `select f.montant_ht as ht, f.timbre,
                (select sum(montant_ht) from facturation.facture_lignes where facture_id = f.id) as somme
           from facturation.factures f where f.id = $1`,
        [id],
      );
      assert.equal(
        Number(facture.rows[0]!.ht),
        Number(facture.rows[0]!.somme),
        "le HT est la somme des lignes",
      );
      assert.ok(Number(facture.rows[0]!.timbre) > 0, "un timbre, un seul : celui de la facture");

      const liens = await db.query(
        "select 1 from facturation.facture_recharges where facture_id = $1",
        [id],
      );
      assert.equal(
        liens.rows.length,
        1,
        "la recharge est rattachée à sa facture, et une seule fois",
      );
    });
  });
});
