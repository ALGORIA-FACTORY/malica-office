/**
 * La liste des sociétés des Réglages (planche 4) se lit d'un appel : l'offre
 * et le cabinet de chaque société de l'appelant — et rien d'une société
 * dont il n'est pas membre.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";
import { personnesDEssai } from "../personne-d-essai.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && ADMIN);

describe("la liste des sociétés se lit d'un appel", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const marque = `fiches-${Date.now()}`;
  const moi = randomUUID();
  const autre = randomUUID();
  const orgs: string[] = [];

  const rpc = (methode: string, ...args: unknown[]) =>
    sousIdentite(moi, (db) => executerRpc(db, { depot: "facturation", methode, args }));

  const org = async (kind: string, nom: string) => {
    const r = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ($1, $2, 'TN', 'TND') returning id`,
      [kind, `${nom} ${marque}`],
    );
    orgs.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  };

  let a = "";
  let b = "";
  let etrangere = "";
  let cabinet = "";

  before(async () => {
    await personnesDEssai(admin, moi, autre);
    a = await org("pme", "Alpha");
    b = await org("pme", "Beta");
    etrangere = await org("pme", "Ailleurs");
    cabinet = await org("cabinet", "Cabinet");
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role)
       values ($1, $3, 'dirigeant'), ($2, $3, 'dirigeant'), ($4, $5, 'dirigeant')`,
      [a, b, moi, etrangere, autre],
    );
    await admin.query("select facturation.licence_naitre($1, $2, 'solo', current_date)", [a, moi]);
    await admin.query(
      `insert into identity.engagements (pme_org_id, cabinet_org_id, status) values ($1, $2, 'actif')`,
      [a, cabinet],
    );
  });

  after(async () => {
    await admin.query(
      `update identity.organizations
          set archived_at = now(), archived_reason = 'fixture de test automatisé'
        where id = any($1::uuid[])`,
      [orgs],
    );
    await admin.end();
    await fermerLePool();
  });

  it("l'offre et le cabinet de chacune, dans l'ordre demandé ; jamais une étrangère", async () => {
    const fiches = (await rpc("fichesDesSocietes", [b, etrangere, a])) as Array<{
      tenantId: string;
      offre: string | null;
      cabinet: string | null;
      cabinetId: string | null;
    }>;
    assert.deepEqual(
      fiches.map((f) => f.tenantId),
      [b, a],
    );
    const fa = fiches.find((f) => f.tenantId === a)!;
    assert.equal(fa.offre, "solo");
    assert.equal(fa.cabinet, `Cabinet ${marque}`);
    assert.equal(fa.cabinetId, cabinet);
    assert.equal(fiches.find((f) => f.tenantId === b)!.cabinet, null);
  });
});
