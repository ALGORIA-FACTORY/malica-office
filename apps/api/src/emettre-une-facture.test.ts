/**
 * `facturation.emettre`, de bout en bout, avec une vraie licence.
 *
 * La première correction de la devise n'avait mesuré que la jointure qui la
 * lit : la fonction, elle, n'avait jamais tourné. Ici elle tourne — sous le
 * rôle `authenticated`, en opérateur de la plateforme, sur une licence
 * insérée pour l'occasion — et on lit la devise sur la FACTURE produite.
 *
 * Tout se passe dans une transaction annulée : rien ne reste en base.
 *
 * La devise de l'émetteur est volontairement différente de celle du pack de
 * juridiction (une monnaie qui n'est pas celle du pack). Si la facture la
 * reprenait du pack, ou d'un défaut de colonne, le test le verrait.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];

const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

/** Exécute `corps` dans une transaction qu'on annule toujours. */
async function aBlanc<T>(corps: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    return await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

/** Une licence, un opérateur de plateforme, et (si demandé) un émetteur. */
async function preparer(
  db: pg.PoolClient,
  monnaieEmetteur: string | null,
): Promise<{ licence: string; operateur: string }> {
  const operateur = randomUUID();
  const licence = randomUUID();
  const titulaire = randomUUID();
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, 'solo', current_date)`,
    [licence, titulaire],
  );
  // Une licence sans organisation ne se facture pas : `factures_organisations_check`
  // exige au moins une organisation. On en rattache une, la plus simple.
  const { rows: abonnee } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Abonnee d''essai', 'TN', 'TND') returning id`,
  );
  // Le titulaire doit être dirigeant de l'organisation qu'il rattache.
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [abonnee[0]!.id, titulaire],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, abonnee[0]!.id],
  );
  if (monnaieEmetteur) {
    const { rows } = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', 'Emetteur d''essai', 'TN', $1) returning id`,
      [monnaieEmetteur],
    );
    await db.query(
      `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
       values ($1, date '2026-01-01', $2)`,
      [rows[0]!.id, operateur],
    );
  }
  return { licence, operateur };
}

async function enOperateur(db: pg.PoolClient, operateur: string): Promise<void> {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [operateur]);
}

describe("facturation.emettre", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("porte sur la facture la devise de l'émetteur, et le taux et le timbre de son pack", async () => {
    await aBlanc(async (db) => {
      const { licence, operateur } = await preparer(db, "EUR");
      await enOperateur(db, operateur);

      const { rows: r } = await db.query<{ r: { facture_id: string } }>(
        "select facturation.emettre($1, date '2026-10-01') as r",
        [licence],
      );
      const { rows } = await db.query<{ devise: string; taux_tva: string; timbre: string }>(
        "select devise, taux_tva, timbre from facturation.factures where id = $1",
        [r[0]!.r.facture_id],
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.devise, "EUR", "la devise est celle de l'émetteur désigné");
      assert.ok(
        Number(rows[0]!.taux_tva) > 0,
        "le taux vient du pack de la juridiction de l'émetteur",
      );
      assert.ok(Number(rows[0]!.timbre) > 0, "le timbre aussi");
    });
  });

  it("refuse d'émettre tant qu'aucun émetteur n'est désigné, sans repli", async () => {
    await aBlanc(async (db) => {
      const { licence, operateur } = await preparer(db, null);
      await enOperateur(db, operateur);

      await db.query("savepoint avant");
      await assert.rejects(
        db.query("select facturation.emettre($1, date '2026-10-01')", [licence]),
        /aucun emetteur designe/,
      );
      await db.query("rollback to savepoint avant");

      const { rows } = await db.query("select 1 from facturation.factures where licence_id = $1", [
        licence,
      ]);
      assert.equal(rows.length, 0, "aucune facture n'a été émise");
    });
  });

  it("ne laisse émettre que la plateforme", async () => {
    await aBlanc(async (db) => {
      const { licence } = await preparer(db, "EUR");
      await enOperateur(db, randomUUID());

      await assert.rejects(
        db.query("select facturation.emettre($1, date '2026-10-01')", [licence]),
        /reserve aux operateurs/,
      );
    });
  });
});
