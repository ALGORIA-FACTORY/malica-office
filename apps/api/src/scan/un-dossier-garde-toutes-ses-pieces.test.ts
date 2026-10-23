/**
 * Un dossier de l'accueil garde toutes ses pièces (revue Codex de #80).
 *
 * Les pochettes et la page Dossier rangent les pièces par type. Elles lisaient
 * le type dans `capture.lister`, qui s'arrête aux cent dernières : au-delà, les
 * plus anciennes disparaissaient du dossier et de son compte. Le type vient
 * désormais de `capture.listAvecLecture`, qui rend toute la collection.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** Au-delà de la borne de `capture.lister`. */
const PIECES = 101;

describe("un dossier garde toutes ses pièces", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `dossier-${Date.now()}`;
  let dirigeant: Utilisateur;
  let pme = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  before(async () => {
    const d = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d);
    dirigeant = d;
    pme = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME ${marque}`, matriculeDEssai()],
      );
      return rows[0]!.id;
    });
    await sousIdentite(dirigeant.id, (db) =>
      db.query(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key,
                                     created_by, document_kind, document_kind_statut)
         select $1, 'pdf', 'entite', $2 || n || '.pdf', $2 || n, $3,
                'facture_achat', 'confirme'
           from generate_series(1, $4::int) n`,
        [pme, `essai/${marque}-`, dirigeant.id, PIECES],
      ),
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [pme],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("listAvecLecture rend le type de chaque pièce, au-delà de la borne de lister", async () => {
    const [bornee, toutes] = await sousIdentite(dirigeant.id, async (db) => [
      (await executerRpc(db, { depot: "capture", methode: "lister", args: [pme] })) as unknown[],
      (await executerRpc(db, {
        depot: "capture",
        methode: "listAvecLecture",
        args: [pme],
      })) as Array<{ typeDeDocument: string | null }>,
    ]);
    assert.ok(bornee.length < PIECES, "lister est bornée : sinon cette épreuve ne prouve rien");
    assert.equal(toutes.length, PIECES);
    assert.equal(toutes.filter((p) => p.typeDeDocument === "facture_achat").length, PIECES);
  });
});
