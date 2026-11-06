/**
 * Une clé d'API part avec son auteur (audit de sécurité du 6 novembre 2026, S3).
 *
 * Reproduit : un membre du cabinet crée une clé `["ecritures.lire",
 * "pieces.deposer"]` ; on retire son adhésion ; `capture.enregistrer` PAR LA
 * CLÉ rendait 200 (pièce créée) quand le même geste par sa session rendait
 * `refus.geste.non_permis`. `api_key_resoudre` ne regardait que l'empreinte,
 * la révocation et l'archivage du cabinet.
 *
 * Ce qu'il établit, contre la vraie base et la vraie application :
 *   — l'adhésion partie, la clé ne résout plus (401), et la liste du cabinet
 *     la montre révoquée, avec sa trace au journal d'audit ;
 *   — de même quand l'auteur reste membre mais n'est plus expert, le seul rôle
 *     qui crée une clé ;
 *   — la clé d'un membre resté, elle, continue de servir ;
 *   — la résolution exige à elle seule l'adhésion de l'auteur : même si la
 *     révocation n'a pas eu lieu (déclencheurs coupés), la clé ne résout pas.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env --env-file-if-exists=.env.test \
 *     --import ./src/garde-base-de-test.ts --test src/une-cle-part-avec-son-auteur.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { resoudreCle } from "./cles-api.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

interface CleVue {
  id: string;
  revokedAt: string | null;
}

describe("une clé d'API part avec son auteur", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `cle-auteur-${Date.now()}`;
  let admin: pg.Pool;
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  let expert: Utilisateur;
  let nadia: Utilisateur;
  let karim: Utilisateur;
  let sami: Utilisateur;
  let cabinet = "";
  let n = 0;

  before(async () => {
    admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

    const compte = async (nom: string) => {
      const u = await creerCompte(`${nom}-${marque}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(u, `compte ${nom}`);
      return u;
    };
    expert = await compte("expert");
    nadia = await compte("nadia");
    karim = await compte("karim");
    sami = await compte("sami");

    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'mandate', null, 'TN', 'TND') as id`,
        [`ESSAI CABINET ${marque}`],
      );
      return rows[0]!.id;
    });
    // Experts du cabinet, comme lui : seul ce rôle crée une clé (`api_keys_insert_expert`).
    for (const u of [nadia, karim, sami]) {
      await admin.query(
        `insert into identity.memberships (tenant_id, user_id, role)
         values ($1, $2, 'expert')`,
        [cabinet, u.id],
      );
    }
  });

  after(async () => {
    try {
      if (cabinet) {
        await admin.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = $1 and archived_at is null`,
          [cabinet],
        );
      }
      await admin?.end();
      await arret?.();
    } finally {
      await fermerLePool();
    }
  });

  const rpc = (qui: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(qui.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  const creerCle = async (qui: Utilisateur) =>
    (await rpc(qui, "integrations.creerCle", cabinet, `Outil de ${marque}`, [
      "ecritures.lire",
      "pieces.deposer",
    ])) as { id: string; cle: string };

  /** `capture.enregistrer` par la clé, comme l'audit l'a joué. */
  const deposerParLaCle = async (cle: string) => {
    n += 1;
    const r = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cle}` },
      body: JSON.stringify({
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: cabinet,
            source: "photo",
            vis: "entite",
            idempotencyKey: `${marque}-${n}`,
            contentType: "image/jpeg",
            pageCount: 1,
          },
        ],
      }),
    });
    return r.status;
  };

  const liste = async () => (await rpc(expert, "integrations.cles", cabinet)) as CleVue[];

  it("l'adhésion partie, la clé ne résout plus et se lit révoquée", async () => {
    const deNadia = await creerCle(nadia);
    const deLExpert = await creerCle(expert);
    assert.equal(await deposerParLaCle(deNadia.cle), 200);

    await admin.query(`delete from identity.memberships where tenant_id = $1 and user_id = $2`, [
      cabinet,
      nadia.id,
    ]);

    assert.equal(await deposerParLaCle(deNadia.cle), 401);
    assert.equal(await deposerParLaCle(deLExpert.cle), 200, "la clé d'un membre resté sert");

    const vues = await liste();
    assert.ok(vues.find((k) => k.id === deNadia.id)?.revokedAt, "révoquée à l'écran");
    assert.equal(vues.find((k) => k.id === deLExpert.id)?.revokedAt, null);

    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from audit.event_log
        where object_id = $1 and action = 'api_key.revoquee'`,
      [deNadia.id],
    );
    assert.equal(rows[0]!.n, 1, "la révocation laisse sa trace");

    // Revenir au cabinet ne ranime pas la clé : elle est révoquée, pour de bon.
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role)
       values ($1, $2, 'expert')`,
      [cabinet, nadia.id],
    );
    assert.equal(await deposerParLaCle(deNadia.cle), 401);
  });

  it("l'auteur qui n'est plus expert ne tient plus sa clé", async () => {
    const deSami = await creerCle(sami);
    assert.equal(await deposerParLaCle(deSami.cle), 200);

    await admin.query(
      `update identity.memberships set role = 'collaborateur'
        where tenant_id = $1 and user_id = $2`,
      [cabinet, sami.id],
    );

    assert.equal(await deposerParLaCle(deSami.cle), 401);
    assert.ok((await liste()).find((k) => k.id === deSami.id)?.revokedAt, "révoquée à l'écran");

    // Collaborateur désormais : il ne crée plus de clé, et le refus se dit.
    await assert.rejects(creerCle(sami), /refus\.cle_api\.expert_membre$/);
  });

  it("la résolution exige à elle seule l'adhésion de l'auteur", async () => {
    const deKarim = await creerCle(karim);
    assert.ok(await resoudreCle(deKarim.cle));

    // Les déclencheurs coupés : l'adhésion part, la clé reste non révoquée.
    const db = await admin.connect();
    try {
      await db.query("begin");
      await db.query("set local session_replication_role = replica");
      await db.query(`delete from identity.memberships where tenant_id = $1 and user_id = $2`, [
        cabinet,
        karim.id,
      ]);
      await db.query("commit");
    } finally {
      db.release();
    }
    const { rows } = await admin.query<{ revoked_at: Date | null }>(
      `select revoked_at from identity.api_keys where id = $1`,
      [deKarim.id],
    );
    assert.equal(rows[0]!.revoked_at, null);

    assert.equal(await resoudreCle(deKarim.cle), null);
    assert.equal(await deposerParLaCle(deKarim.cle), 401);
  });
});
