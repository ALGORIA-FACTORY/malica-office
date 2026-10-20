/**
 * Une adresse ne fait plus d'opérateur (20 octobre 2026).
 *
 * Le produit ne vérifie pas les adresses : faire opérateur le premier compte
 * créé avec une adresse « attendue » donnait la tour à quiconque s'inscrivait
 * le premier. Le déclencheur est retiré ; un compte créé avec une adresse
 * autrefois attendue reste un compte ordinaire.
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

describe("une adresse ne fait plus d'opérateur", { skip: !BASE_CONFIGUREE }, () => {
  const attendu = `attendu-${Date.now()}@essai.local`;
  const pool = new pg.Pool({ connectionString: ADMIN });
  const crees: string[] = [];

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

  it("un compte créé avec une adresse attendue n'est pas opérateur", async () => {
    await pool.query(
      `insert into app.operateurs_attendus (email, note) values ($1, 'fixture de test automatisé')`,
      [attendu],
    );
    const a = await creerCompte(attendu, "MotDePasseTresLong2026!");
    assert.ok(a);
    crees.push(a.id);
    const { rows } = await pool.query(`select 1 from app.platform_operators where user_id = $1`, [
      a.id,
    ]);
    assert.equal(rows.length, 0);
  });

  it("le déclencheur n'existe plus", async () => {
    const { rows } = await pool.query(
      `select 1 from pg_trigger where tgname = 'operateur_attendu' and not tgisinternal`,
    );
    assert.equal(rows.length, 0);
  });
});
