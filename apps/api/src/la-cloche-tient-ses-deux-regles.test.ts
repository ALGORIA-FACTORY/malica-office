/**
 * La cloche du moteur de notifications : ce qu'elle rend, et ce qu'elle garde.
 *
 * Remplace `la-cloche-dit-la-meme-chose.test.ts`, retiré avec l'ancien fil : son
 * oracle lisait `notifications_v`, qui n'existe plus. Ici, l'oracle est écrit à
 * partir de la règle du contrat, pas de la fonction :
 *
 *   - toute notification NON LUE de la personne sort, sans limite ;
 *   - une notification LUE ne sort que si elle fait partie des cent plus récentes
 *     de la personne (toutes notifications confondues) ;
 *   - l'ordre est le plus récent d'abord.
 *
 *   node --experimental-strip-types --test src/la-cloche-tient-ses-deux-regles.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

const EMISES = 130;
const PLAFOND = 100;

describe("la cloche du moteur de notifications", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `cloche-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}M/A/M/000`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let pme = "";

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d);
    dirigeant = d;
    pme = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME ${marque}`, legalId],
      );
      return rows[0]!.id;
    });
    for (let i = 0; i < EMISES; i += 1) {
      await admin.query(
        `select notif.emettre($1, 'piece.retournee', jsonb_build_object('n', $2::int))`,
        [pme, i],
      );
    }
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [pme],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  /** Les lignes de la personne, la plus récente d'abord : l'oracle, lu sur la table. */
  const attendues = async () =>
    (
      await admin.query<{ id: string; read_at: string | null }>(
        `select e.id,
                (select s.cree_le from notif.suites s
                  where s.envoi_id = e.id and s.nature = 'lue') as read_at
           from notif.envois e
          where e.destinataire = $1 and e.canal = 'app' and e.tenant_id = $2
          order by e.cree_le desc, e.id`,
        [dirigeant.id, pme],
      )
    ).rows;

  const cloche = () =>
    sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string; read_at: string | null }>(
        `select id, read_at from notif.centre($1::uuid[]) order by created_at desc, id`,
        [[pme]],
      );
      return rows;
    });

  it("toutes les non lues sortent, et les lues ne sortent que dans les cent plus récentes", async () => {
    const toutes = await attendues();
    assert.equal(toutes.length, EMISES);

    // Les trente plus anciennes sont lues : elles sortent de la cloche.
    const anciennes = toutes.slice(-30).map((r) => r.id);
    for (const id of anciennes) {
      await sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query(`select public.notification_marquer_lue($1)`, [id]),
      );
    }
    // Une lue parmi les cent plus récentes : elle reste visible, lue.
    const centieme = toutes[PLAFOND - 1]!.id;
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query(`select public.notification_marquer_lue($1)`, [centieme]),
    );

    const attendu = toutes.slice(0, PLAFOND).map((r) => r.id);
    const rendues = await cloche();
    assert.deepEqual(
      rendues.map((r) => r.id),
      attendu,
    );
    assert.equal(rendues.filter((r) => r.read_at === null).length, PLAFOND - 1);
    assert.ok(rendues.find((r) => r.id === centieme)?.read_at, "la lue des cent reste lue");
    for (const id of anciennes)
      assert.ok(!rendues.some((r) => r.id === id), "une lue ancienne ne sort pas");
  });
});
