/**
 * Les réglages du cabinet sont à l'expert (20 octobre 2026).
 *
 * Recette : un collaborateur a porté le seuil de validation en lot de 90 à
 * 95 % — ce qui part sans regard humain. Ce seuil engage l'expert-comptable.
 *
 *   node --experimental-strip-types --test src/les-reglages-du-cabinet-sont-a-l-expert.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("les réglages du cabinet sont à l'expert", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `reglages-expert-${Date.now()}`;
  let expert: Utilisateur;
  let collaborateur: Utilisateur;
  let cabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const definir = (u: Utilisateur, lot: number) =>
    sousIdentite(u.id, (db) =>
      db.query(
        `select public.cabinet_reglages_definir($1, $2, 0.70, null, true, 20, 'sobre', 0.80)`,
        [cabinet, lot],
      ),
    );

  before(async () => {
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const c = await creerCompte(`collab-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(e && c);
    expert = e;
    collaborateur = c;
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`COMPTA ${marque}`],
      );
      return rows[0]!.id;
    });
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [cabinet, collaborateur.id],
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [cabinet],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("l'expert règle les seuils", async () => {
    await definir(expert, 0.9);
    const { rows } = await admin.query<{ s: string }>(
      `select seuil_confiance_lot::text as s from collab.reglages_cabinet where tenant_id = $1`,
      [cabinet],
    );
    assert.equal(rows[0]?.s, "0.90");
  });

  it("le collaborateur est refusé, en clair, et rien ne change", async () => {
    await assert.rejects(definir(collaborateur, 0.95), /réservés à l'expert-comptable/);
    const { rows } = await admin.query<{ s: string }>(
      `select seuil_confiance_lot::text as s from collab.reglages_cabinet where tenant_id = $1`,
      [cabinet],
    );
    assert.equal(rows[0]?.s, "0.90");
  });
});
