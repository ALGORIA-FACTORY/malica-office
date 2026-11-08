/**
 * Les deux portes ont leurs types — planche 3, approuvée le 7 novembre 2026.
 *
 * En correction, la porte Achats ouvre facture, avoir, bon de livraison et
 * note de frais : chacun s'enregistre. Un type qui n'est ni proposé à la
 * photo ni en correction reste refusé.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";
import { personnesDEssai } from "./personne-d-essai.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && ADMIN);

describe("les deux portes ont leurs types", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const marque = `portes-${Date.now()}`;
  const dirigeant = randomUUID();
  let tenant = "";
  let piece = "";

  const preciser = (valeur: string) =>
    sousIdentite(dirigeant, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "preciser",
        args: [piece, "document_kind", valeur],
      }),
    ) as Promise<{ valeur: string }>;

  before(async () => {
    const org = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`Portes ${marque}`],
    );
    tenant = org.rows[0]!.id;
    await personnesDEssai(admin, dirigeant);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')`,
      [tenant, dirigeant],
    );
    const r = await admin.query<{ id: string }>(
      `insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key, created_by)
       values ($1, 'entite', 'photo', 'essai/rien', $2, $3) returning id`,
      [tenant, `${marque}-${randomUUID()}`, dirigeant],
    );
    piece = r.rows[0]!.id;
  });

  after(async () => {
    await admin.query(
      `update identity.organizations
          set archived_at = now(), archived_reason = 'fixture de test automatisé'
        where id = $1`,
      [tenant],
    );
    await admin.end();
    await fermerLePool();
  });

  for (const type of ["avoir", "bon_livraison", "note_frais", "facture_achat"]) {
    it(`« ${type} » se choisit en correction`, async () => {
      const r = await preciser(type);
      assert.equal(r.valeur, type);
      const { rows } = await admin.query<{ document_kind: string; document_kind_statut: string }>(
        `select document_kind, document_kind_statut from capture.pieces where id = $1`,
        [piece],
      );
      assert.equal(rows[0]?.document_kind, type);
      assert.equal(rows[0]?.document_kind_statut, "confirme");
    });
  }

  it("un type ni proposé à la photo ni en correction reste refusé", async () => {
    const { rows } = await admin.query<{ code: string }>(
      `select code from ref.document_types
        where not propose_a_la_capture and not propose_en_correction limit 1`,
    );
    if (!rows[0]) return;
    await assert.rejects(preciser(rows[0].code), /type_non_propose/);
  });
});
