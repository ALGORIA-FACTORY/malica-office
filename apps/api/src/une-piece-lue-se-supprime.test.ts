/**
 * Une pièce lue se supprime, et sa lecture reste comptée (20 octobre 2026).
 *
 * Recette : « Supprimer cette pièce » rendait une erreur interne sur toute
 * pièce déjà lue — la lecture comptée retenait la pièce par une clé étrangère.
 *
 *   node --experimental-strip-types --test src/une-piece-lue-se-supprime.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une pièce lue se supprime, et sa lecture reste", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `supprimer-lue-${Date.now()}`;
  let dirigeant: Utilisateur;
  let pme = "";
  let piece = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d);
    dirigeant = d;
    pme = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME ${marque}`, `${String(Date.now()).slice(-7)}R/A/M/000`],
      );
      return rows[0]!.id;
    });
    piece = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by)
         values ($1, 'pdf', 'personnel', $2, $3, $4) returning id`,
        [pme, `essai/${marque}.pdf`, marque, dirigeant.id],
      );
      return rows[0]!.id;
    });
    await admin.query(
      `insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
       select $1, lo.licence_id, $2, date_trunc('month', current_date)::date, $3
         from facturation.licence_organisations lo where lo.tenant_id = $1`,
      [pme, piece, dirigeant.id],
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [pme],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("la pièce part, la lecture comptée reste", async () => {
    // La porte de la base, celle qu'appelle `capture.supprimer` (le dépôt
    // efface ensuite les octets du disque, sans objet ici).
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query(`select public.capture_piece_supprimer($1, false)`, [piece]),
    );
    const { rows: pieces } = await admin.query(`select 1 from capture.pieces where id = $1`, [
      piece,
    ]);
    assert.equal(pieces.length, 0);
    const { rows: lectures } = await admin.query(
      `select 1 from facturation.lectures where piece_id = $1`,
      [piece],
    );
    assert.equal(lectures.length, 1);
  });
});
