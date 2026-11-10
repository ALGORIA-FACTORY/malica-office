/**
 * Le débit de « Parler à Malica » : le quota du jour, compté en base, par personne.
 *
 * Les bornes sont celles de `plateforme.assistant_debits` (R4) : l'épreuve les
 * LIT, elle n'en écrit aucune — changer le réglage ici changerait celui des
 * autres épreuves, qui partagent la base. La rafale de la minute, comptée en
 * mémoire, a son épreuve pure (`malica/assistant/debit.test.ts`).
 *
 *   node --experimental-strip-types --test src/le-debit-de-malica.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { conseil } from "./depots/conseil.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le débit de Malica", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `debit-${Date.now()}`;
  let u: Utilisateur;
  let autre: Utilisateur;
  let org = "";
  let fil = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  /** `n` questions de la personne, rangées il y a `age` (un intervalle SQL). */
  const poser = (n: number, age: string) =>
    admin.query(
      `insert into agents.conversation_messages (conversation_id, role, contenu, created_at)
       select $1, 'user', 'question ' || g, now() - $3::interval
         from generate_series(1, $2::int) g`,
      [fil, n, age],
    );

  before(async () => {
    const a = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const b = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(a && b);
    u = a;
    autre = b;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `ESSAI ${marque}`, "autonome", "TN", "TND"],
      );
      return rows[0]!.org;
    });
    const c = await admin.query<{ id: string }>(
      `insert into agents.conversations (tenant_id, created_by, titre)
       values ($1, $2, 'débit') returning id`,
      [org, u.id],
    );
    fil = c.rows[0]!.id;
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

  it("rend les bornes réglées en base et ce que la personne a demandé aujourd'hui", async () => {
    const { rows } = await admin.query<{ par_minute: number; par_jour: number }>(
      `select par_minute, par_jour from plateforme.assistant_debits
        order by decide_le desc, id desc limit 1`,
    );
    const regle = rows[0]!;
    await poser(3, "1 hour");
    await poser(5, "2 days");
    const d = await sousIdentiteDuServeur(u.id, (db) => conseil.exigerDebit(db));
    // Les questions de plus d'un jour ne comptent plus.
    assert.deepEqual(d, { parMinute: regle.par_minute, parJour: regle.par_jour, duJour: 3 });
  });

  it("refuse au quota du jour, par une clé — et seulement la personne qui l'a atteint", async () => {
    const avant = await sousIdentiteDuServeur(u.id, (db) => conseil.exigerDebit(db));
    await poser(avant.parJour - avant.duJour, "10 minutes");
    await assert.rejects(
      sousIdentiteDuServeur(u.id, (db) => conseil.exigerDebit(db)),
      /refus\.assistant\.quota_du_jour/,
    );
    const voisin = await sousIdentiteDuServeur(autre.id, (db) => conseil.exigerDebit(db));
    assert.equal(voisin.duJour, 0);
  });

  it("le réglage ne se lit pas par un client, et ne se réécrit pas", async () => {
    const lu = await sousIdentiteDuServeur(u.id, (db) =>
      db.query(`select 1 from plateforme.assistant_debits`),
    );
    assert.equal(lu.rows.length, 0);
    await assert.rejects(
      sousIdentiteDuServeur(u.id, (db) =>
        db.query(
          `insert into plateforme.assistant_debits (par_minute, par_jour, motif) values (600, 100000, 'x')`,
        ),
      ),
      /permission denied|row-level security/,
    );
    await assert.rejects(
      admin.query(`update plateforme.assistant_debits set par_jour = par_jour`),
      /./,
    );
  });
});
