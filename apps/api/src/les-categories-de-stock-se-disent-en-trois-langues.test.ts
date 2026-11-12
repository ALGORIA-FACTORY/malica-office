/**
 * Les catégories de stock se disent dans la langue de la personne, accents
 * compris (recette du 11 novembre 2026, 5.4 : « Matieres premieres »).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "./personne-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("stocks.categories", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("rend « Matières premières » en français, et un nom dans chaque langue", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const { rows } = await db.query<{ id: string }>(
        `select p.id from ref.jurisdiction_packs p
          where exists (select 1 from ref.stock_categories c
                         where c.pack_version_id = p.id and c.code = 'matieres_premieres')
          limit 1`,
      );
      const pack = rows[0]!.id;
      const qui = randomUUID();
      await personnesDEssai(db, qui);
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
      const lire = async (locale: string) =>
        (
          (await executerRpc(db, {
            depot: "stocks",
            methode: "categories",
            args: [pack, locale],
          })) as Array<{ code: string; label: string }>
        ).find((c) => c.code === "matieres_premieres")?.label;
      assert.equal(await lire("fr"), "Matières premières");
      assert.equal(await lire("en"), "Raw materials");
      assert.equal(await lire("ar"), "مواد أولية");
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
