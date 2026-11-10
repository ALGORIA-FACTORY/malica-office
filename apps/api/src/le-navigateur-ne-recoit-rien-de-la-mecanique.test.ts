/**
 * Le navigateur ne reçoit rien de la mécanique.
 *
 * Ni le modèle, ni les jetons, ni la durée technique d'un fil rouvert : ils
 * restent au journal des agents, pour la tour. Les clés demeurent (une
 * application installée les lit) ; leur valeur est neutre. La charge est lue
 * telle que le réseau la porte, en chaîne : aucun nom de fournisseur n'y passe.
 *
 *   node --experimental-strip-types --test src/le-navigateur-ne-recoit-rien-de-la-mecanique.test.ts
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

describe("un fil rouvert ne dit rien de la mécanique", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `fil-meca-${Date.now()}`;
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

  it("la base garde le modèle, les jetons et la durée ; le fil rouvert n'en rend aucun", async () => {
    const c = await admin.query<{ id: string }>(
      `insert into agents.conversations (tenant_id, created_by, titre)
       values ($1, $2, 'mécanique') returning id`,
      [org, u.id],
    );
    const fil = c.rows[0]!.id;
    await admin.query(
      `insert into agents.conversation_messages (conversation_id, role, contenu)
       values ($1, 'user', 'Où en est ma TVA ?')`,
      [fil],
    );
    await admin.query(
      `insert into agents.conversation_messages
         (conversation_id, role, contenu, model, tokens_in, tokens_out, latency_ms)
       values ($1, 'assistant', 'Un crédit.', 'claude-sonnet-5-5', 1234, 567, 8901)`,
      [fil],
    );

    const gardees = await admin.query(
      `select model, tokens_in, tokens_out, latency_ms from agents.conversation_messages
        where conversation_id = $1 and role = 'assistant'`,
      [fil],
    );
    assert.deepEqual(gardees.rows[0], {
      model: "claude-sonnet-5-5",
      tokens_in: 1234,
      tokens_out: 567,
      latency_ms: 8901,
    });

    const relu = await sousIdentiteDuServeur(u.id, (db) => conversations.ouvrir(db, fil));
    const reponse = relu.find((m) => m.role === "assistant")!;
    assert.deepEqual(
      [reponse.model, reponse.tokensIn, reponse.tokensOut, reponse.latencyMs, reponse.raisonnement],
      [null, null, null, null, null],
    );
    const sur_le_reseau = JSON.stringify(relu);
    assert.doesNotMatch(sur_le_reseau, /claude|sonnet|haiku|deepseek|anthropic|1234|567|8901/i);
    assert.equal(reponse.contenu, "Un crédit.");
  });
});
