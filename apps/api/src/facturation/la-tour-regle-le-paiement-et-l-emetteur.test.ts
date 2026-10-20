/**
 * La tour règle le paiement et l'émetteur — et un client n'y touche pas.
 *
 * Et le simulateur, qui peut désormais s'ouvrir partout, ne fait entrer aucun
 * argent : ses « payés » ne s'imputent jamais sur une facture.
 *
 * Tout se passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { matriculeDEssai } from "../matricule-d-essai.ts";
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

const refuse = (e: { code?: string }) => e.code === "42501";

describe("la tour règle le paiement et l'émetteur", { skip: !ADMIN }, () => {
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

  async function operateur(db: pg.PoolClient) {
    const id = randomUUID();
    await db.query("insert into app.platform_operators (user_id) values ($1)", [id]);
    return id;
  }

  it("le réglage du paiement : la tour décide, tout le monde le lit, sans secret", async () => {
    await aBlanc(async (db) => {
      const op = await operateur(db);
      const client = randomUUID();
      const avant = await sous(db, client, () =>
        db.query<{ r: { prestataire: string } }>("select public.paiement_reglage() as r"),
      );
      assert.equal(avant.rows[0]!.r.prestataire, "aucun", "fermé tant que la tour n'a rien dit");

      await assert.rejects(
        sous(db, client, () =>
          db.query(
            "select plateforme.paiement_regler('simulateur', null, 'https://x.tn', 'essai')",
          ),
        ),
        refuse,
      );
      await sous(db, op, () =>
        db.query(
          "select plateforme.paiement_regler('simulateur', null, 'https://staging.exemple.tn/', 'recette')",
        ),
      );
      const apres = await sous(db, client, () =>
        db.query<{ r: Record<string, unknown> }>("select public.paiement_reglage() as r"),
      );
      assert.equal(apres.rows[0]!.r["prestataire"], "simulateur");
      assert.equal(apres.rows[0]!.r["url_retour"], "https://staging.exemple.tn");
      assert.deepEqual(
        Object.keys(apres.rows[0]!.r).sort(),
        ["decide_le", "prestataire", "url_api", "url_retour"],
        "aucun secret ne sort",
      );

      await db.query("savepoint s");
      await assert.rejects(
        sous(db, op, () =>
          db.query(
            "select plateforme.paiement_regler('clictopay', null, 'https://x.tn', 'sans api')",
          ),
        ),
        (e: { code?: string }) => e.code === "23514",
        "ClicToPay sans adresse d'API est refusé",
      );
      await db.query("rollback to savepoint s");
    });
  });

  it("l'émetteur se désigne par la tour, pour aujourd'hui ou plus tard", async () => {
    await aBlanc(async (db) => {
      const op = await operateur(db);
      const o = await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, legal_id, jurisdiction, currency)
         values ('pme', 'ALGORIA FACTORY d''essai', '${matriculeDEssai("A", "M")}', 'TN', 'TND') returning id`,
      );
      const trouvee = await sous(db, op, () =>
        db.query<{ nom: string }>(
          "select nom from plateforme.organisations_chercher('ALGORIA FACTORY d')",
        ),
      );
      assert.ok(trouvee.rows.some((r) => r.nom === "ALGORIA FACTORY d'essai"));

      await assert.rejects(
        sous(db, randomUUID(), () =>
          db.query("select plateforme.emetteur_designer($1, current_date, 'essai')", [
            o.rows[0]!.id,
          ]),
        ),
        refuse,
      );
      await assert.rejects(
        sous(db, op, () =>
          db.query("select plateforme.emetteur_designer($1, current_date - 1, 'essai')", [
            o.rows[0]!.id,
          ]),
        ),
        /aujourd'hui ou plus tard/,
      );
      await sous(db, op, () =>
        db.query("select plateforme.emetteur_designer($1, current_date, 'essai')", [o.rows[0]!.id]),
      );
      const e = await sous(db, op, () =>
        db.query<{ r: { nom: string } }>("select plateforme.emetteur_en_vigueur() as r"),
      );
      assert.equal(e.rows[0]!.r.nom, "ALGORIA FACTORY d'essai");
    });
  });
});
