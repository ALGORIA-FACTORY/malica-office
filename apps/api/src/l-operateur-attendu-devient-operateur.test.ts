/**
 * L'opérateur attendu devient opérateur à la création de son compte
 * (20 octobre 2026).
 *
 * La tour ne s'ouvre qu'aux opérateurs de la plateforme, et ce niveau ne
 * s'accorde par aucune route. Une adresse inscrite par migration dans
 * `app.operateurs_attendus` devient opérateur au moment où le compte est
 * créé — une fois, puis l'attente se referme.
 *
 *   node --experimental-strip-types --test src/l-operateur-attendu-devient-operateur.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { creerCompte } from "./auth.ts";
import { fermerLePool } from "./db.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && ADMIN);

describe("l'opérateur attendu devient opérateur", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `operateur-${Date.now()}`;
  const attendu = `attendu-${marque}@essai.local`;
  const ordinaire = `ordinaire-${marque}@essai.local`;
  const pool = new pg.Pool({ connectionString: ADMIN });
  const crees: string[] = [];

  const estOperateur = async (id: string) => {
    const { rows } = await pool.query(`select 1 from app.platform_operators where user_id = $1`, [
      id,
    ]);
    return rows.length === 1;
  };

  after(async () => {
    try {
      await pool.query(`delete from app.platform_operators where user_id = any($1::uuid[])`, [
        crees,
      ]);
      await pool.query(`delete from app.operateurs_attendus where email = $1`, [attendu]);
    } finally {
      await pool.end();
      await fermerLePool();
    }
  });

  it("l'adresse attendue devient opérateur, l'autre non", async () => {
    await pool.query(
      `insert into app.operateurs_attendus (email, note) values ($1, 'fixture de test automatisé')`,
      [attendu],
    );
    const a = await creerCompte(attendu, "MotDePasseTresLong2026!");
    const o = await creerCompte(ordinaire, "MotDePasseTresLong2026!");
    assert.ok(a && o);
    crees.push(a.id, o.id);

    assert.equal(await estOperateur(a.id), true);
    assert.equal(await estOperateur(o.id), false);

    const { rows } = await pool.query<{ honore_le: Date | null }>(
      `select honore_le from app.operateurs_attendus where email = $1`,
      [attendu],
    );
    assert.ok(rows[0]?.honore_le, "l'attente se referme une fois honorée");
  });

  it("le dirigeant d'ALGORIA est attendu", async () => {
    const { rows } = await pool.query(
      `select 1 from app.operateurs_attendus where email = 'w.barouni@algoria-factory.com'`,
    );
    assert.equal(rows.length, 1);
  });
});
