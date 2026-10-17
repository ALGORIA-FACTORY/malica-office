/**
 * Une lecture s'impute à la licence de SON organisation, et à aucune autre.
 *
 * `facturation_lectures_ins` ne vérifiait que `tenant_id in app.member_orgs()`.
 * `licence_id` et `piece_id` étaient libres — seule une clé étrangère les
 * tenait. Or `lecture_autorisee` prend l'EXISTENCE d'une ligne dans
 * `facturation.lectures` pour une preuve de comptage (`relecture_gratuite`).
 *
 * Le trou, mesuré par la relecture du 19 octobre : un collaborateur à 65/65
 * reçoit `plafond_atteint`, insère une ligne portant son tenant, LA LICENCE
 * D'UN TIERS et sa propre pièce (`INSERT 0 1`), et `lecture_autorisee` rend
 * ensuite `relecture_gratuite`. Le plafond est contourné, et le quota du tiers
 * consommé par la même insertion.
 *
 * R6 décide où va la garde : un filtre oublié dans du code applicatif OUVRE
 * l'accès, une politique oubliée le REFUSE. Elle va donc dans la base, dans le
 * `with check` de la table.
 *
 * La moitié qui compte le plus est la dernière : une politique qui refuse tout
 * est aussi fausse qu'une politique qui accepte tout. L'insertion légitime doit
 * passer.
 *
 * Tout se passe dans une transaction annulée : rien n'est écrit, donc rien à
 * archiver (R7).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Cabinet {
  dirigeant: string;
  collaborateur: string;
  tenant: string;
  licence: string;
  /** Une pièce `entite` de ce tenant, non encore comptée. */
  piece: string;
}

async function nouvellePiece(
  db: pg.PoolClient,
  tenant: string,
  auteur: string,
  cle: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into capture.pieces
       (tenant_id, vis, source, storage_path, idempotency_key, created_by)
     values ($1, 'entite', 'photo', $2, $2, $3) returning id`,
    [tenant, `${cle}-${randomUUID()}`, auteur],
  );
  return rows[0]!.id;
}

/** Une organisation `basic` (65 lectures), son dirigeant, un collaborateur. */
async function monter(db: pg.PoolClient, consommees: number): Promise<Cabinet> {
  const dirigeant = randomUUID();
  const collaborateur = randomUUID();
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Imputation d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = org.rows[0]!.id;
  await db.query(
    `insert into identity.memberships (tenant_id, user_id, role)
     values ($1, $2, 'dirigeant'), ($1, $3, 'collaborateur')`,
    [tenant, dirigeant, collaborateur],
  );

  const licence = randomUUID();
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis, statut)
     values ($1, $2, 'basic', current_date, 'active')`,
    [licence, dirigeant],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );

  for (let i = 0; i < consommees; i++) {
    const piece = await nouvellePiece(db, tenant, dirigeant, `deja-${i}`);
    await db.query(
      `insert into facturation.lectures
         (tenant_id, licence_id, piece_id, periode, consommee_par)
       values ($1, $2, $3, date_trunc('month', current_date)::date, $4)`,
      [tenant, licence, piece, dirigeant],
    );
  }

  const piece = await nouvellePiece(db, tenant, dirigeant, "a-lire");
  return { dirigeant, collaborateur, tenant, licence, piece };
}

/** Endosse `authenticated` sous l'identité donnée, le temps du corps. */
async function sous<T>(db: pg.PoolClient, identite: string, corps: () => Promise<T>): Promise<T> {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [identite]);
  try {
    return await corps();
  } finally {
    await db.query("reset role");
  }
}

const INSERER_LECTURE = `insert into facturation.lectures
    (tenant_id, licence_id, piece_id, periode)
  values ($1, $2, $3, date_trunc('month', current_date)::date)`;

describe("une lecture s'impute à la bonne licence", { skip: !ADMIN }, () => {
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

  it("une ligne portant la licence d'un tiers est refusée", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);
      const b = await monter(db, 0);

      await sous(db, a.collaborateur, async () => {
        await db.query("savepoint avant");
        await assert.rejects(
          db.query(INSERER_LECTURE, [a.tenant, b.licence, a.piece]),
          (e: { code?: string }) => {
            assert.equal(e.code, "42501", "le refus doit venir de la politique d'écriture");
            return true;
          },
          "la licence d'un tiers ne s'impute pas",
        );
        await db.query("rollback to savepoint avant");
      });
    });
  });

  it("une ligne portant la pièce d'un autre tenant est refusée", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);
      const b = await monter(db, 0);

      await sous(db, a.collaborateur, async () => {
        await db.query("savepoint avant");
        await assert.rejects(
          db.query(INSERER_LECTURE, [a.tenant, a.licence, b.piece]),
          (e: { code?: string }) => {
            assert.equal(e.code, "42501", "le refus doit venir de la politique d'écriture");
            return true;
          },
          "la pièce d'un autre dossier ne s'impute pas ici",
        );
        await db.query("rollback to savepoint avant");
      });
    });
  });

  it("l'insertion légitime passe toujours : son tenant, sa licence, sa pièce", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);

      const comptees = await sous(db, a.collaborateur, async () => {
        const { rowCount } = await db.query(INSERER_LECTURE, [a.tenant, a.licence, a.piece]);
        return rowCount;
      });
      assert.equal(comptees, 1, "un membre compte la lecture de sa propre pièce");

      const { rows } = await db.query<{ licence_id: string; tenant_id: string }>(
        "select licence_id, tenant_id from facturation.lectures where piece_id = $1",
        [a.piece],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.licence_id, a.licence);
      assert.equal(rows[0]!.tenant_id, a.tenant);
    });
  });

  it("un collaborateur à 65/65 ne fabrique plus sa relecture gratuite", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 65);
      const b = await monter(db, 0);

      await sous(db, a.collaborateur, async () => {
        const avant = await db.query<{ v: Record<string, unknown> }>(
          "select public.lecture_autorisee($1) as v",
          [a.piece],
        );
        assert.equal(avant.rows[0]!.v["autorisee"], false);
        assert.equal(avant.rows[0]!.v["motif"], "plafond_atteint");

        await db.query("savepoint avant");
        await assert.rejects(
          db.query(INSERER_LECTURE, [a.tenant, b.licence, a.piece]),
          (e: { code?: string }) => {
            assert.equal(e.code, "42501");
            return true;
          },
          "la ligne forgée ne doit pas entrer",
        );
        await db.query("rollback to savepoint avant");

        const apres = await db.query<{ v: Record<string, unknown> }>(
          "select public.lecture_autorisee($1) as v",
          [a.piece],
        );
        assert.equal(apres.rows[0]!.v["autorisee"], false, "le plafond tient après la tentative");
        assert.equal(apres.rows[0]!.v["motif"], "plafond_atteint");

        await db.query("savepoint avant_consommer");
        await assert.rejects(
          db.query("select public.lecture_consommer($1)", [a.piece]),
          /lecture refusee : plafond_atteint/,
        );
        await db.query("rollback to savepoint avant_consommer");
      });

      const { rows } = await db.query("select 1 from facturation.lectures where piece_id = $1", [
        a.piece,
      ]);
      assert.equal(rows.length, 0, "aucune lecture ne doit être comptée");
      const quotaDuTiers = await db.query(
        "select 1 from facturation.lectures where licence_id = $1",
        [b.licence],
      );
      assert.equal(quotaDuTiers.rows.length, 0, "le quota du tiers reste intact");
    });
  });
});
