/**
 * L'espace privé a ses rayons — planche 10, approuvée le 7 novembre 2026.
 *
 * Un papier gardé pour soi reçoit un rayon et un nom, donnés par son auteur.
 * Personne d'autre ne les lit ni ne les écrit — pas même le dirigeant — et
 * on ne range qu'un papier PRIVÉ dont on est l'auteur.
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

describe("l'espace privé a ses rayons", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const marque = `rayons-${Date.now()}`;
  const amel = randomUUID();
  const patron = randomUUID();
  let tenant = "";
  let privee = "";
  let societe = "";
  let duPatron = "";

  const rpc = (qui: string, methode: string, ...args: unknown[]) =>
    sousIdentite(qui, (db) => executerRpc(db, { depot: "capture", methode, args }));

  const piece = async (auteur: string, vis: string) => {
    const r = await admin.query<{ id: string }>(
      `insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key, created_by)
       values ($1, $2::app.vis_t, 'photo', 'essai/rien', $3, $4) returning id`,
      [tenant, vis, `${marque}-${randomUUID()}`, auteur],
    );
    return r.rows[0]!.id;
  };

  before(async () => {
    const org = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`Rayons ${marque}`],
    );
    tenant = org.rows[0]!.id;
    await personnesDEssai(admin, amel, patron);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role)
       values ($1, $2, 'collaborateur'), ($1, $3, 'dirigeant')`,
      [tenant, amel, patron],
    );
    privee = await piece(amel, "personnel");
    societe = await piece(amel, "entite");
    duPatron = await piece(patron, "personnel");
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

  it("son auteur range un papier privé : un rayon, un nom", async () => {
    const r = (await rpc(amel, "rangerPrive", privee, "sante", " Ordonnance juin ")) as {
      rayon: string;
      nom: string;
    };
    assert.equal(r.rayon, "sante");
    assert.equal(r.nom, "Ordonnance juin");
    const miens = (await rpc(amel, "mesRangementsPrives", tenant)) as Array<{ pieceId: string }>;
    assert.deepEqual(
      miens.map((x) => x.pieceId),
      [privee],
    );
  });

  it("un nouveau rangement remplace l'ancien ; un nom vide s'efface", async () => {
    const r = (await rpc(amel, "rangerPrive", privee, "Voyage", "")) as {
      rayon: string;
      nom: string | null;
    };
    assert.equal(r.rayon, "Voyage");
    assert.equal(r.nom, null);
  });

  it("le dirigeant ne lit pas les rayons d'un autre", async () => {
    const siens = (await rpc(patron, "mesRangementsPrives", tenant)) as unknown[];
    assert.equal(siens.length, 0);
  });

  it("on ne range ni le papier d'un autre, ni un papier de la société", async () => {
    await assert.rejects(rpc(patron, "rangerPrive", privee, "maison", null));
    await assert.rejects(rpc(amel, "rangerPrive", duPatron, "maison", null));
    await assert.rejects(rpc(amel, "rangerPrive", societe, "maison", null));
  });

  it("un rayon vide ou trop long est refusé", async () => {
    await assert.rejects(rpc(amel, "rangerPrive", privee, "   ", null));
    await assert.rejects(rpc(amel, "rangerPrive", privee, "x".repeat(41), null));
  });
});
