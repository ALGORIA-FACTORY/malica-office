/**
 * Une pièce qui en accompagne une autre ne se lit pas (20 octobre 2026).
 *
 * Recette PME : le reçu généré et le justificatif d'un paiement étaient lus,
 * consommaient deux lectures, et le reçu devenait une « facture d'achat ».
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une pièce qui en accompagne une autre ne se lit pas", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `accompagne-${Date.now()}`;
  let dirigeant: Utilisateur;
  let pme = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const piece = (cle: string, source: string | null = null) =>
    sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key,
                                     created_by, source_piece_id)
         values ($1, 'pdf', 'entite', $2, $3, $4, $5) returning id`,
        [pme, `essai/${marque}-${cle}.pdf`, `${marque}-${cle}`, dirigeant.id, source],
      );
      return rows[0]!.id;
    });

  const verdict = (id: string) =>
    sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ v: { autorisee: boolean; motif: string } }>(
        `select public.lecture_autorisee($1) as v`,
        [id],
      );
      return rows[0]!.v;
    });

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

  it("la facture se lit ; le reçu qui en est issu, non", async () => {
    const facture = await piece("facture");
    assert.equal((await verdict(facture)).autorisee, true);
    const recu = await piece("recu", facture);
    const v = await verdict(recu);
    assert.equal(v.autorisee, false);
    assert.equal(v.motif, "piece_accompagnante");
  });
});
