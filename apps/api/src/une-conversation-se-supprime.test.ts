/**
 * Une conversation avec Malica se supprime, même quand une réponse a
 * déclenché un contrôle (audit du 27 octobre 2026).
 *
 * Effacer un fil emporte ses messages ; les contrôles déclenchés par une
 * réponse sont conservés, détachés du message (`ON DELETE SET NULL`) —
 * « ils survivent à l'effacement d'une conversation » dit leur migration.
 * Mais leur garde STRICT `app.deny_mutation` refusait ce détachement : la
 * suppression levait R7, et le fil restait.
 *
 * Le détachement est désormais permis, et seulement lui : hors de la
 * disparition du message, la table reste immuable.
 *
 *   node --experimental-strip-types --test src/une-conversation-se-supprime.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { conversations } from "./depots/conversations.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une conversation se supprime", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `conv-suppr-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  /** Un fil, une réponse de Malica, un contrôle que la réponse a déclenché. */
  async function filAvecControle(): Promise<{ conversation: string; controle: string }> {
    const c = await admin.query<{ id: string }>(
      `insert into agents.conversations (tenant_id, created_by, titre)
       values ($1, $2, 'essai') returning id`,
      [org, u.id],
    );
    const m = await admin.query<{ id: string }>(
      `insert into agents.conversation_messages (conversation_id, role, contenu)
       values ($1, 'assistant', 'réponse') returning id`,
      [c.rows[0]!.id],
    );
    const r = await admin.query<{ id: string }>(
      `insert into agents.reponse_controles (tenant_id, message_id, controle, suite, detail)
       values ($1, $2, 'chiffre_cite', 'signaler', 'essai') returning id`,
      [org, m.rows[0]!.id],
    );
    return { conversation: c.rows[0]!.id, controle: r.rows[0]!.id };
  }

  before(async () => {
    const c = await creerCompte(`d-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `ESSAI ${marque}`, "autonome", "TN", "TND"],
      );
      return rows[0]!.org;
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

  it("le fil s'efface ; le contrôle survit, détaché", async () => {
    const f = await filAvecControle();
    await sousIdentiteDuServeur(u.id, (db) => conversations.supprimer(db, f.conversation));
    const fil = await admin.query(`select 1 from agents.conversations where id = $1`, [
      f.conversation,
    ]);
    assert.equal(fil.rows.length, 0, "le fil est toujours là");
    const ctl = await admin.query<{ message_id: string | null }>(
      `select message_id from agents.reponse_controles where id = $1`,
      [f.controle],
    );
    assert.deepEqual(ctl.rows, [{ message_id: null }]);
  });

  it("hors de la disparition du message, le contrôle reste immuable", async () => {
    const f = await filAvecControle();
    await assert.rejects(
      admin.query(`update agents.reponse_controles set message_id = null where id = $1`, [
        f.controle,
      ]),
      /R7|interdit/i,
    );
    await assert.rejects(
      admin.query(`update agents.reponse_controles set detail = 'autre' where id = $1`, [
        f.controle,
      ]),
      /R7|interdit/i,
    );
  });
});
