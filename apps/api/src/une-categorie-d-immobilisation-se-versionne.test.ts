/**
 * Une catégorie d'immobilisation se versionne ; elle ne se réécrit pas.
 *
 * Revue du 24 octobre 2026 : les comptes NC 01 entrent par une ligne datée du
 * 24 octobre, la ligne du 1er janvier est close la veille. Un bien déjà
 * enregistré garde la ligne qu'il pointe — ses dotations ne changent pas de
 * compte en cours de vie — et seule la ligne en vigueur s'offre à un bien
 * nouveau.
 *
 *   node --experimental-strip-types --test src/une-categorie-d-immobilisation-se-versionne.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { creerCompte } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { immo } from "./depots/immo.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const BASE_CONFIGUREE = Boolean(ADMIN && process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("une catégorie d'immobilisation se versionne", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: ADMIN });

  after(async () => {
    await admin.end();
    await fermerLePool();
  });

  const packTN = async () =>
    (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN' and version = '2026.1'`,
      )
    ).rows[0]!.id;

  it("la ligne du 1er janvier reste, close, et la ligne NC 01 lui succède", async () => {
    const { rows } = await admin.query<{
      valid_from: string;
      valid_to: string | null;
      account_immo: string;
      account_amort: string;
    }>(
      `select valid_from::text, valid_to::text, account_immo, account_amort
         from ref.immo_categories where pack_version_id = $1 and code = 'constructions'
        order by valid_from`,
      [await packTN()],
    );
    assert.equal(rows.length, 2, "deux versions, aucune réécrite");
    assert.deepEqual(
      rows.map((r) => [r.valid_from, r.valid_to]),
      [
        ["2026-01-01", "2026-10-23"],
        ["2026-10-24", null],
      ],
    );
    assert.notEqual(rows[0]!.account_immo, rows[1]!.account_immo, "l'ancienne garde ses comptes");
  });

  it("l'écran ne propose qu'une catégorie par code : celle en vigueur", async () => {
    const pack = await packTN();
    const u = await creerCompte(`immo-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    const categories = await sousIdentiteDuServeur(u.id, (db) => immo.categories(db, pack));
    const codes = categories.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length, "aucun doublon de catégorie");
    const { rows: enVigueur } = await admin.query<{ id: string }>(
      `select id from ref.immo_categories
        where pack_version_id = $1 and valid_to is null`,
      [pack],
    );
    assert.deepEqual(
      categories.map((c) => c.id).sort(),
      enVigueur.map((r) => r.id).sort(),
      "seules les lignes ouvertes s'offrent à un bien nouveau",
    );
  });

  it("un compte de catégorie nouvelle doit exister au plan de son pack", async () => {
    const pack = await packTN();
    const client = await admin.connect();
    try {
      await client.query("begin");
      await assert.rejects(
        client.query(
          `insert into ref.immo_categories
             (pack_version_id, code, label, method, duree_annees, coefficient,
              account_immo, account_amort, account_dotation, valid_from)
           values ($1, 'essai_hors_plan', 'Essai', 'lineaire', 5, 1, '2999', '282', '68112',
                   date '2026-10-24')`,
          [pack],
        ),
        (e: { code?: string }) => e.code === "23503",
      );
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
