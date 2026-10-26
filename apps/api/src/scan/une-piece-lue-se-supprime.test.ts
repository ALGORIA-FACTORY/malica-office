/**
 * Une pièce LUE, pas encore envoyée au cabinet, se supprime — même lue par
 * une recette de la fabrique.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 27 octobre 2026, Wissem sur staging : « la suppression n'a aucun effet ».
 * Une lecture par recette inscrit une exécution dans `fabrique.executions`,
 * liée à la pièce par une clé qui cascade. Cette table portait le garde
 * STRICT `app.deny_mutation()`, qui ignore le drapeau `malica.piece_effacable`
 * posé par `capture_piece_supprimer` : la cascade levait R7, et toute pièce
 * lue par une recette devenait impossible à supprimer. L'erreur s'affichait
 * en haut de la fiche, loin du bouton.
 *
 * Même chose pour la trace de l'appel au modèle (`agents.agent_runs`, SET
 * NULL) : son garde n'avait pas de passage pour le détachement.
 *
 * La garantie inverse reste : hors effacement d'une pièce, la table refuse
 * toujours un DELETE direct.
 *
 *   node --experimental-strip-types --test src/scan/une-piece-lue-se-supprime.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une pièce lue se supprime", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `suppr-lue-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let version = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  /** Une pièce de la société, lue, et dont la lecture est passée par une recette. */
  async function lueParRecette(cle: string): Promise<string> {
    return sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by)
         values ($1, 'photo', 'entite', $2, $3, $4) returning id`,
        [org, `essai/${marque}-${cle}.jpg`, `${marque}-${cle}`, u.id],
      );
      const id = rows[0]!.id;
      await db.query(
        `insert into fabrique.executions (tenant_id, recette_version_id, piece_id, issue)
         values ($1, $2, $3, 'designation')`,
        [org, version, id],
      );
      return id;
    });
  }
  /** La trace de l'appel au modèle qui a lu la pièce. */
  const tracer = (pieceId: string) =>
    admin.query(
      `insert into agents.agent_runs (tenant_id, piece_id, agent, model, sovereign, status, created_by)
       values ($1, $2, 'lecture', 'essai', true, 'ok', $3)`,
      [org, pieceId, u.id],
    );
  const existe = async (id: string) =>
    (await admin.query(`select 1 from capture.pieces where id = $1`, [id])).rows.length === 1;

  before(async () => {
    const c = await creerCompte(`d-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `ESSAI ${marque}`, "autonome", "TN", "TND"],
      );
      org = rows[0]!.org;
      const r = await db.query<{ id: string }>(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, $2, $3, 'organisation') returning id`,
        [org, "essai", `essai-${marque}`],
      );
      const v = await db.query<{ id: string }>(
        `insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte)
         values ($1, $2, 1, $3, $4) returning id`,
        [org, r.rows[0]!.id, JSON.stringify({ version: 1, champs: [] }), "a".repeat(64)],
      );
      version = v.rows[0]!.id;
    });
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [org],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("le dirigeant supprime une pièce de la société lue par une recette et par le modèle", async () => {
    const id = await lueParRecette("a");
    await tracer(id);
    const fait = await sousIdentiteDuServeur(u.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "supprimer", args: [id] }),
    );
    assert.equal(fait, true);
    assert.equal(await existe(id), false, "la pièce est toujours là");
    const { rows } = await admin.query(
      `select piece_id from agents.agent_runs where tenant_id = $1`,
      [org],
    );
    assert.deepEqual(
      rows.map((r) => r.piece_id),
      [null],
      "la trace de l'appel survit, détachée",
    );
  });

  it("hors effacement d'une pièce, l'exécution reste indélébile", async () => {
    const id = await lueParRecette("b");
    await tracer(id);
    await assert.rejects(
      admin.query(`update agents.agent_runs set piece_id = null where piece_id = $1`, [id]),
      /R7|interdit/i,
    );
    await assert.rejects(
      admin.query(`delete from fabrique.executions where piece_id = $1`, [id]),
      /R7|interdit/i,
    );
  });
});
