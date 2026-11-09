/**
 * Un fil se relit dans l'ordre où il a été dit.
 *
 * Relevé le 9 novembre 2026 en revérifiant les constats du chat
 * (`docs/validation-chat-malica/constats.md`) : une question et sa réponse sont
 * rangées dans la même transaction, donc au même `created_at`. Le fil se triait
 * ensuite par `created_at, id` — un identifiant aléatoire — et une fois sur deux
 * la réponse revenait AVANT sa question : à l'écran d'un fil rouvert, et dans le
 * passé que le modèle relit.
 *
 * Vingt échanges rangés comme l'application les range : le fil relu alterne
 * question puis réponse. Au hasard, il n'y parviendrait qu'une fois sur un
 * million.
 *
 *   node --experimental-strip-types --test src/un-fil-se-relit-dans-l-ordre.test.ts
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

describe("un fil se relit dans l'ordre", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `fil-ordre-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

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

  it("vingt échanges rangés au même instant se relisent question puis réponse", async () => {
    const c = await admin.query<{ id: string }>(
      `insert into agents.conversations (tenant_id, created_by, titre)
       values ($1, $2, 'ordre') returning id`,
      [org, u.id],
    );
    const fil = c.rows[0]!.id;
    for (let i = 0; i < 20; i += 1) {
      const client = await admin.connect();
      try {
        // Une transaction par échange : la question et la réponse partagent `now()`.
        await client.query("begin");
        await client.query(
          `insert into agents.conversation_messages (conversation_id, role, contenu)
           values ($1, 'user', $2)`,
          [fil, `question ${i}`],
        );
        await client.query(
          `insert into agents.conversation_messages (conversation_id, role, contenu)
           values ($1, 'assistant', $2)`,
          [fil, `réponse ${i}`],
        );
        await client.query("commit");
      } finally {
        client.release();
      }
    }

    const relu = await sousIdentiteDuServeur(u.id, (db) => conversations.ouvrir(db, fil));
    assert.deepEqual(
      relu.map((m) => m.contenu),
      Array.from({ length: 20 }, (_, i) => [`question ${i}`, `réponse ${i}`]).flat(),
    );
  });
});
