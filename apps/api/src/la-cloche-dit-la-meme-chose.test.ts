/**
 * La cloche, lue d'un trait, dit la même chose que ligne par ligne
 * (migration 20261208095000, 9 novembre 2026).
 *
 * `app.notifications_des_societes` porte la règle de
 * `app.notification_lisible` sans la rejouer à chaque ligne. L'ORACLE est
 * l'ancienne lecture, par la politique de `collab.notifications` : sous
 * l'identité de chacun, les deux doivent rendre les mêmes notifications,
 * lues ou non, dans le même ordre.
 *
 *   node --experimental-strip-types --test src/la-cloche-dit-la-meme-chose.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

const ORACLE = `
  with lues as (
    select n.id, n.tenant_id, n.kind, n.payload, n.created_at,
           coalesce(
             (select l.lu_le from collab.notification_lectures l
               where l.tenant_id = n.tenant_id and l.notification_id = n.id
                 and l.user_id = auth.uid()),
             case when n.tenant_id in (select app.member_orgs()) then n.read_at end
           ) as read_at,
           row_number() over (order by n.created_at desc, n.id) as rang
      from notifications_v n where n.tenant_id = any($1::uuid[])
  )
  select id, tenant_id, kind, payload, created_at, read_at
    from lues
   where read_at is null or rang <= 100
   order by created_at desc, id`;

const LE_TRAIT = `
  select id, tenant_id, kind, payload, created_at, read_at
    from app.notifications_des_societes($1::uuid[])
   order by created_at desc, id`;

/** Les deux lectures au même instant : d'autres épreuves écrivent en parallèle. */
const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"], max: 2 });

type Ligne = Record<string, unknown>;

async function lesDeux(utilisateur: string, tenants: string[]) {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [utilisateur]);
    await client.query("select set_config('malica.origine', 'serveur', true)");
    const oracle = await client.query<Ligne>(ORACLE, [tenants]);
    const trait = await client.query<Ligne>(LE_TRAIT, [tenants]);
    await client.query("commit");
    return { oracle: oracle.rows, trait: trait.rows };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

describe("la cloche dit la même chose", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let autre: SocieteDEssai;
  const toutes: Personne[] = ["amel", "bilel", "sami", "sonia", "expert"];

  before(async () => {
    const marque = `cloche-${Date.now()}`;
    s = await monterUneSociete(marque);
    autre = await monterUneSociete(`${marque}-voisin`);

    const privee = await s.deposer("sami", "personnel");
    const enSociete = await s.deposer("sami", "entite");
    const deBilel = await s.deposer("bilel", "entite");
    const partagee = await s.deposer("amel", "entite");
    await s.lire("amel", partagee);
    await s.fait("amel", "collab.envoyer", partagee);
    const archivee = await s.deposer("amel", "entite");
    await s.admin.query(`update capture.pieces set archivee_le = now() where id = $1`, [archivee]);

    const noter = (tenant: string, payload: unknown, user: string | null = null) =>
      s.admin.query(
        `insert into collab.notifications (tenant_id, user_id, kind, payload)
         values ($1, $2, 'piece.retournee', $3::jsonb)`,
        [tenant, user, JSON.stringify(payload)],
      );
    for (const piece of [privee, enSociete, deBilel, partagee, archivee]) {
      await noter(s.pme, { piece_id: piece });
      await noter(s.pme, { piece_id: piece, chez: "proprietaire" });
      await noter(s.cabinet, { piece_id: piece });
    }
    await noter(s.pme, { note: "sans pièce" });
    await noter(s.pme, { piece_id: "00000000-0000-4000-8000-000000000000" });
    await noter(s.pme, { piece_id: "pas-un-identifiant" });
    await noter(s.pme, { note: "pour sami" }, s.gens.sami.id);
    await noter(s.cabinet, { note: "pour le cabinet" });
    await noter(autre.pme, { note: "à côté" });

    // Une notification qu'Amel LIT à coup sûr : la sienne, sans pièce ni
    // destinataire. `limit 1` sans ordre rendait tantôt celle d'une pièce privée
    // de Sami, que la politique lui refuse (`refus.introuvable.notification`).
    const { rows } = await s.admin.query<{ id: string }>(
      `select id from collab.notifications
        where tenant_id = $1 and user_id is null and payload = '{"note":"sans pièce"}'::jsonb`,
      [s.pme],
    );
    assert.equal(rows.length, 1, "la notification sans pièce de la PME");
    await s.fait("amel", "collab.markRead", rows[0]!.id);
  });

  after(async () => {
    await pool.end();
    await s.fermer();
    await autre.fermer();
    await fermerLePool();
  });

  it("les mêmes notifications, pour chacun, sur ses dossiers", async () => {
    for (const qui of toutes) {
      const { oracle, trait } = await lesDeux(s.gens[qui].id, [s.pme, s.cabinet, autre.pme]);
      assert.deepEqual(trait, oracle, qui);
    }
    const { oracle } = await lesDeux(s.gens.amel.id, [s.pme, s.cabinet, autre.pme]);
    assert.ok(oracle.length >= 10, `${oracle.length} notifications pour la propriétaire`);
  });

  it("une personne étrangère ne reçoit rien", async () => {
    const { oracle, trait } = await lesDeux(autre.gens.sonia.id, [s.pme, s.cabinet]);
    assert.deepEqual(oracle, []);
    assert.deepEqual(trait, []);
  });

  it("et sur toutes les notifications que la base porte", async () => {
    const { rows } = await s.admin.query<{ tenant_id: string }>(
      `select distinct tenant_id from collab.notifications`,
    );
    const tenants = rows.map((r) => r.tenant_id);
    for (const qui of toutes) {
      const { oracle, trait } = await lesDeux(s.gens[qui].id, tenants);
      assert.deepEqual(trait, oracle, qui);
    }
  });
});
