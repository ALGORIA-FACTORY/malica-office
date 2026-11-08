/**
 * Une clé que l'écran montre active résout (vérification indépendante de
 * c9c3d9ad, « une clé part avec son auteur »).
 *
 * Depuis 20261202110000, `api_key_resoudre` exige une adhésion RÉELLE d'expert
 * de l'auteur. Or un opérateur sous l'accès total crée une clé dans un cabinet
 * dont il n'est pas membre (`api_keys_insert_expert` lit `app.has_org_role`,
 * qui compte l'adhésion virtuelle) : la porte rend une clé, l'écran
 * Intégrations du cabinet la liste active, et elle ne résout jamais (401).
 *
 * Ce qu'il exige : une clé créée et listée active résout ; sinon, la porte
 * refuse de la créer.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env --env-file-if-exists=.env.test \
 *     --import ./src/garde-base-de-test.ts --test src/une-cle-active-a-l-ecran-resout.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { resoudreCle } from "./cles-api.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une clé active à l'écran résout", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `cle-active-${Date.now()}`;
  let admin: pg.Pool;
  let expert: Utilisateur;
  let operateur: Utilisateur;
  let cabinet = "";

  before(async () => {
    admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const mdp = "MotDePasseTresLong2026!";
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    operateur = (await creerCompte(`op-${marque}@essai.local`, mdp))!;
    assert.ok(expert && operateur);
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'mandate', null, 'TN', 'TND') as id`,
        [`ESSAI CABINET ${marque}`],
      );
      return rows[0]!.id;
    });
    await admin.query(`insert into app.platform_operators (user_id, note) values ($1, $2)`, [
      operateur.id,
      `épreuve ${marque}`,
    ]);
    await admin.query(
      `insert into plateforme.acces_total (user_id, actif, motif, par) values ($1, true, $2, $1)`,
      [operateur.id, `épreuve ${marque}`],
    );
  });

  after(async () => {
    try {
      if (operateur) {
        await admin.query(
          `insert into plateforme.acces_total (user_id, actif, motif, par) values ($1, false, $2, $1)`,
          [operateur.id, `fin de l'épreuve ${marque}`],
        );
        await admin.query(`delete from app.platform_operators where user_id = $1`, [operateur.id]);
      }
      if (cabinet) {
        await admin.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = $1 and archived_at is null`,
          [cabinet],
        );
      }
      await admin?.end();
    } finally {
      await fermerLePool();
    }
  });

  const rpc = (qui: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(qui.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  it("la clé créée par un opérateur sous l'accès total résout, ou n'est pas créée", async () => {
    let cle: { id: string; cle: string };
    try {
      cle = (await rpc(operateur, "integrations.creerCle", cabinet, `Outil ${marque}`, [
        "ecritures.lire",
      ])) as { id: string; cle: string };
    } catch {
      return; // La porte refuse : rien d'actif à l'écran qui ne serve pas.
    }
    const vues = (await rpc(expert, "integrations.cles", cabinet)) as Array<{
      id: string;
      revokedAt: string | null;
    }>;
    const vue = vues.find((k) => k.id === cle.id);
    assert.ok(vue, "la clé est listée au cabinet");
    if (vue.revokedAt === null) {
      assert.ok(await resoudreCle(cle.cle), "listée active, la clé doit résoudre");
    }
  });
});
