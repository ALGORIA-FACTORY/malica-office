/**
 * Une notification se lit par personne (audit du 27 octobre 2026).
 *
 * Le cabinet ne pouvait pas marquer comme lue une notification du dossier de
 * son client : la seule politique de modification de `collab.notifications`
 * exige d'être membre du dossier. L'`update` touchait zéro ligne, sans erreur,
 * et la notification restait « non lue » à vie, badge compris.
 *
 * Et l'eût-il pu, c'eût été faux : un seul `read_at` pour deux lecteurs — la
 * lecture du cabinet aurait effacé le « non lu » du dirigeant. Chaque
 * personne a désormais sa propre lecture.
 *
 *   node --experimental-strip-types --test src/une-notification-se-lit-par-personne.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une notification se lit par personne", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `notif-lue-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}N/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot: "collab", methode, args }));
  const lue = async (u: Utilisateur, id: string) => {
    const liste = (await rpc(u, "notifications", [pme])) as Array<{
      id: string;
      readAt: string | null;
    }>;
    return liste.find((n) => n.id === id)?.readAt ?? null;
  };
  const notifier = async () =>
    (
      await admin.query<{ id: string }>(
        `insert into collab.notifications (tenant_id, kind, payload)
         values ($1, 'piece.reponse_client', '{}'::jsonb) returning id`,
        [pme],
      )
    ).rows[0]!.id;

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, $5, $6) as id`,
          [kind, nom, "autonome", mf, "TN", "TND"],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    await sousIdentiteDuServeur(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.mandatsProposes(db, pme),
    );
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("le cabinet marque lue une notification du dossier de son client", async () => {
    const id = await notifier();
    assert.equal(await lue(expert, id), null);
    await rpc(expert, "markRead", id);
    assert.notEqual(await lue(expert, id), null, "le cabinet la voit toujours non lue");
  });

  it("la lecture du cabinet ne lit pas à la place du dirigeant, et inversement", async () => {
    const id = await notifier();
    await rpc(expert, "markRead", id);
    assert.equal(await lue(dirigeant, id), null, "le dirigeant l'a perdue sans la lire");
    await rpc(dirigeant, "markRead", id);
    assert.notEqual(await lue(dirigeant, id), null);
  });

  it("marquer deux fois ne fait rien de plus ; une notification inconnue est refusée", async () => {
    const id = await notifier();
    await rpc(expert, "markRead", id);
    await rpc(expert, "markRead", id);
    await assert.rejects(
      rpc(expert, "markRead", "00000000-0000-0000-0000-000000000000"),
      /refus\.introuvable\.notification$/,
    );
  });

  it("une notification non lue ne sort jamais de la liste, même après cent plus récentes", async () => {
    const ancienne = async () =>
      (
        await admin.query<{ id: string }>(
          `insert into collab.notifications (tenant_id, kind, payload, created_at)
           values ($1, 'piece.reponse_client', '{}'::jsonb, now() - interval '30 days')
           returning id`,
          [pme],
        )
      ).rows[0]!.id;
    const enAttente = await ancienne();
    const dejaLue = await ancienne();
    await rpc(expert, "markRead", dejaLue);
    await admin.query(
      `insert into collab.notifications (tenant_id, kind, payload)
       select $1, 'piece.reponse_client', '{}'::jsonb from generate_series(1, 100)`,
      [pme],
    );
    const ids = ((await rpc(expert, "notifications", [pme])) as Array<{ id: string }>).map(
      (n) => n.id,
    );
    assert.ok(ids.includes(enAttente), "la notification en attente a disparu de la liste");
    assert.ok(!ids.includes(dejaLue), "une notification lue, plus ancienne que cent, reste");
  });
});
