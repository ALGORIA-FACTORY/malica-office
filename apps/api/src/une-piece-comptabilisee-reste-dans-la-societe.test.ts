/**
 * Une pièce comptabilisée reste dans la société (20 octobre 2026).
 *
 * Recette PME : une pièce comptabilisée par une PME autonome, restée dans la
 * société (`entite`), pouvait passer en espace personnel. L'écriture restait
 * aux livres ; la pièce qui la justifie quittait la société.
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

describe("une pièce comptabilisée reste dans la société", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `reste-${Date.now()}`;
  let dirigeant: Utilisateur;
  let pme = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const piece = (cle: string) =>
    sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by)
         values ($1, 'pdf', 'entite', $2, $3, $4) returning id`,
        [pme, `essai/${marque}-${cle}.pdf`, `${marque}-${cle}`, dirigeant.id],
      );
      return rows[0]!.id;
    });

  const versPersonnel = (id: string) =>
    sousIdentite(dirigeant.id, (db) =>
      db.query(`select public.capture_piece_set_vis($1, 'personnel')`, [id]),
    );

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

  it("une pièce comptabilisée ne passe pas en personnel, même depuis la société", async () => {
    const id = await piece("compta");
    await admin.query(`update capture.pieces set status = 'comptabilisee' where id = $1`, [id]);
    await assert.rejects(versPersonnel(id), /comptabilisee reste dans la societe/);
  });

  it("une pièce non comptabilisée y passe toujours, par son propriétaire", async () => {
    const id = await piece("libre");
    await versPersonnel(id);
    const { rows } = await admin.query<{ vis: string }>(
      `select vis::text from capture.pieces where id = $1`,
      [id],
    );
    assert.equal(rows[0]?.vis, "personnel");
  });

  it("en défaut de paiement, rien de nouveau ne part au cabinet", async () => {
    // Règle du 20 octobre 2026 : impayé → la lecture ET la transmission s'arrêtent.
    const id = await piece("impaye");
    await admin.query(
      `update facturation.licences l set statut = 'suspendue', suspendue_le = now()
         from facturation.licence_organisations lo
        where lo.licence_id = l.id and lo.tenant_id = $1`,
      [pme],
    );
    try {
      await assert.rejects(
        sousIdentite(dirigeant.id, (db) =>
          db.query(`select public.capture_piece_set_vis($1, 'partage')`, [id]),
        ),
        /Transmission suspendue/,
      );
    } finally {
      await admin.query(
        `update facturation.licences l set statut = 'active', suspendue_le = null
           from facturation.licence_organisations lo
          where lo.licence_id = l.id and lo.tenant_id = $1`,
        [pme],
      );
    }
  });
});
