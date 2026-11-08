/**
 * « Partout » ne laisse pas passer un rafraîchissement concurrent
 * (vérification indépendante de c9c3d9ad, « le jeton d'accès se révoque »).
 *
 * `fermerToutesLesSessions` pose `sessions_invalidees_le = now()` (l'instant
 * où SA transaction a commencé) puis révoque les jetons longs `where revoque_le
 * is null`. Un `rafraichir` concurrent, qui tient déjà l'ancien jeton long
 * `for update`, insère son successeur et commite : la mise à jour de
 * « partout », en READ COMMITTED, ne voit pas cette ligne née après le début
 * de sa requête. Le jeton long neuf survit donc à « partout », et le jeton
 * d'accès qu'il donne est émis après l'instant de fermeture.
 *
 * L'ordre est forcé, sans compter sur le hasard : une troisième connexion
 * tient l'ancien jeton long ; le rafraîchissement se met en file derrière
 * elle, puis « partout » derrière lui ; on relâche.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env --env-file-if-exists=.env.test \
 *     --import ./src/garde-base-de-test.ts \
 *     --test src/partout-ne-laisse-pas-passer-un-rafraichissement-concurrent.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import {
  creerCompte,
  emettreJetonDeRafraichissement,
  fermerToutesLesSessions,
  rafraichir,
  type Utilisateur,
} from "./auth.ts";
import { fermerLePool } from "./db.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("« partout » et un rafraîchissement concurrent", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `partout-concurrent-${Date.now()}`;
  let admin: pg.Pool;
  let u: Utilisateur;

  before(async () => {
    admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    u = (await creerCompte(`vol-${marque}@essai.local`, "MotDePasseTresLong2026!"))!;
    assert.ok(u);
  });

  after(async () => {
    try {
      await admin?.end();
    } finally {
      await fermerLePool();
    }
  });

  /** Attend qu'une requête dont le texte contient `extrait` soit en attente d'un verrou. */
  async function attendreEnFile(extrait: string): Promise<void> {
    for (let i = 0; i < 400; i++) {
      const { rows } = await admin.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and position($1 in query) > 0`,
        [extrait],
      );
      if (rows[0]!.n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`jamais en file : ${extrait}`);
  }

  it("le jeton long tourné pendant « partout » ne survit pas", async () => {
    const vole = await emettreJetonDeRafraichissement(u, "coque-android/0.1.0");

    const verrou = await admin.connect();
    let tourne: Awaited<ReturnType<typeof rafraichir>>;
    try {
      await verrou.query("begin");
      await verrou.query(
        `select 1 from auth.refresh_tokens where user_id = $1 and revoque_le is null for update`,
        [u.id],
      );
      const enVol = rafraichir(vole, "coque-android/0.1.0");
      await attendreEnFile("for update of t");
      const partout = fermerToutesLesSessions(u.id);
      await attendreEnFile("update auth.refresh_tokens set revoque_le = now()");
      await verrou.query("commit");
      [tourne] = await Promise.all([enVol, partout]);
    } finally {
      verrou.release();
    }

    assert.ok(tourne, "le rafraîchissement parti avant « partout » a tourné");
    // « Partout » a commité après lui : ce qu'il a rendu doit être fermé.
    const encore = await rafraichir(tourne.jetonRafraichissement, "coque-android/0.1.0");
    assert.equal(encore === null, true, "le jeton long né pendant « partout » ne rafraîchit plus");
  });
});
