/**
 * Le moteur de notifications : une ligne par destinataire, décidée à l'écriture.
 *
 * L'ancien fil décidait QUI lit QUOI à chaque lecture ; le moteur le décide une
 * fois, en rejouant la même règle pour chaque personne qui pourrait la lire. Ce
 * qui est éprouvé ici, c'est que la règle n'a pas bougé — et qu'elle ne fuit pas :
 *
 *   - un événement de société arrive au dirigeant et au cabinet engagé, pas à un tiers ;
 *   - une pièce personnelle ou d'entité ne se cite pas au cabinet, une pièce partagée oui ;
 *   - ce qui est « chez le propriétaire » ne sort pas du dossier ;
 *   - une notification adressée à une personne ne va qu'à elle ;
 *   - l'accès perdu cache le centre, l'accès regagné ne rend pas le passé.
 *
 *   node --experimental-strip-types --test src/le-moteur-de-notifications.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le moteur de notifications", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `moteur-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}M/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let tiers: Utilisateur;
  let affecte: Utilisateur;
  let nonAffecte: Utilisateur;
  let comptable: Utilisateur;
  let pme = "";
  let cabinet = "";
  let autre = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization($1, $2, $3, $4, $5, $6) as id`,
        [kind, nom, "autonome", mf, "TN", "TND"],
      );
      return rows[0]!.id;
    });

  /** Une pièce du dirigeant, avec la visibilité demandée. */
  const piece = async (vis: "personnel" | "entite" | "partage") =>
    (
      await admin.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, created_by, vis, source, storage_path, idempotency_key)
         values ($1, $2, $3::app.vis_t, 'photo', $4, $4) returning id`,
        [pme, dirigeant.id, vis, `${marque}-${vis}-${Math.random()}`],
      )
    ).rows[0]!.id;

  /** Qui reçoit : les personnes de l'audience, parmi les trois du test. */
  const audience = async (donnees: object, personne: string | null = null) => {
    const { rows } = await admin.query<{ a: string }>(
      `select a from notif.audience($1, $2::jsonb, $3) a`,
      [pme, JSON.stringify(donnees), personne],
    );
    const ids = new Set(rows.map((r) => r.a));
    return {
      dirigeant: ids.has(dirigeant.id),
      expert: ids.has(expert.id),
      tiers: ids.has(tiers.id),
    };
  };

  /** Les identifiants de l'audience, pour les personnes que la matrice ci-dessus ne nomme pas. */
  const audienceDe = async (donnees: object) =>
    new Set(
      (
        await admin.query<{ a: string }>(`select a from notif.audience($1, $2::jsonb) a`, [
          pme,
          JSON.stringify(donnees),
        ])
      ).rows.map((r) => r.a),
    );

  const centre = (u: Utilisateur, tenants: string[]) =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{
        id: string;
        kind: string;
        payload: Record<string, unknown>;
        read_at: string | null;
      }>(`select id, kind, payload, read_at from notif.centre($1::uuid[])`, [tenants]);
      return rows;
    });

  before(async () => {
    const mdp = "MotDePasseTresLong2026!";
    const [d, e, t] = await Promise.all([
      creerCompte(`dirigeant-${marque}@essai.local`, mdp),
      creerCompte(`expert-${marque}@essai.local`, mdp),
      creerCompte(`tiers-${marque}@essai.local`, mdp),
    ]);
    assert.ok(d && e && t);
    dirigeant = d;
    expert = e;
    tiers = t;
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    autre = await creer(
      tiers,
      "pme",
      `AUTRE ${marque}`,
      `${String(Date.now()).slice(-7)}Z/A/M/000`,
    );
    await sousIdentiteDuServeur(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.mandatsProposes(db, pme),
    );
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );

    // Deux collaborateurs du cabinet, dont un seul est affecté à ce client, et le
    // comptable interne de la société.
    const [a, n, c] = await Promise.all([
      creerCompte(`affecte-${marque}@essai.local`, mdp),
      creerCompte(`non-affecte-${marque}@essai.local`, mdp),
      creerCompte(`comptable-${marque}@essai.local`, mdp),
    ]);
    assert.ok(a && n && c);
    affecte = a;
    nonAffecte = n;
    comptable = c;
    for (const [tenant, u, role] of [
      [cabinet, affecte, "collaborateur"],
      [cabinet, nonAffecte, "collaborateur"],
      [pme, comptable, "comptable"],
    ] as const) {
      await admin.query(
        `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
        [tenant, u.id, role],
      );
    }
    await admin.query(
      `insert into collab.assignments (cabinet_tenant_id, client_tenant_id, collaborator_id)
       values ($1, $2, $3)`,
      [cabinet, pme, affecte.id],
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet, autre].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("un événement de société arrive au dirigeant et au cabinet engagé, jamais à un tiers", async () => {
    assert.deepEqual(await audience({}), { dirigeant: true, expert: true, tiers: false });
  });

  it("ce qui est chez le propriétaire ne sort pas du dossier", async () => {
    assert.deepEqual(await audience({ chez: "proprietaire" }), {
      dirigeant: true,
      expert: false,
      tiers: false,
    });
  });

  it("une pièce personnelle ou d'entité ne se cite pas au cabinet, une pièce partagée oui", async () => {
    assert.deepEqual(await audience({ piece_id: await piece("personnel") }), {
      dirigeant: true,
      expert: false,
      tiers: false,
    });
    assert.deepEqual(await audience({ piece_id: await piece("entite") }), {
      dirigeant: true,
      expert: false,
      tiers: false,
    });
    assert.deepEqual(await audience({ piece_id: await piece("partage") }), {
      dirigeant: true,
      expert: true,
      tiers: false,
    });
  });

  it("une pièce qui n'existe plus ne ferme pas la porte au cabinet ni au dirigeant", async () => {
    assert.deepEqual(await audience({ piece_id: "00000000-0000-0000-0000-000000000000" }), {
      dirigeant: true,
      expert: true,
      tiers: false,
    });
  });

  it("une notification adressée à une personne ne va qu'à elle", async () => {
    assert.deepEqual(await audience({}, dirigeant.id), {
      dirigeant: true,
      expert: false,
      tiers: false,
    });
  });

  it("le collaborateur affecté reçoit comme le cabinet ; celui qui ne l'est pas, rien", async () => {
    const sansPiece = await audienceDe({});
    assert.ok(sansPiece.has(affecte.id), "le collaborateur affecté est prévenu");
    assert.ok(!sansPiece.has(nonAffecte.id), "un collaborateur non affecté ne l'est pas");

    const partagee = await audienceDe({ piece_id: await piece("partage") });
    assert.ok(partagee.has(affecte.id), "il lit une pièce partagée du client qu'il suit");
    assert.ok(!partagee.has(nonAffecte.id));

    const entite = await audienceDe({ piece_id: await piece("entite") });
    assert.ok(!entite.has(affecte.id), "une pièce d'entité ne se cite pas au cabinet");
  });

  it("le comptable interne reçoit comme un membre de la société, et ne lit pas la pièce d'un autre", async () => {
    assert.ok((await audienceDe({})).has(comptable.id), "membre : il est prévenu");
    assert.ok(
      (await audienceDe({ chez: "proprietaire" })).has(comptable.id),
      "ce qui est chez le propriétaire reste dans la société",
    );
    assert.ok(
      !(await audienceDe({ piece_id: await piece("personnel") })).has(comptable.id),
      "la pièce personnelle du dirigeant ne lui est pas citée",
    );
  });

  it("l'identité est rendue : l'audience ne laisse pas la transaction sous un autre nom", async () => {
    const client = await admin.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [dirigeant.id]);
      await client.query(`select count(*) from notif.audience($1, '{}'::jsonb)`, [pme]);
      const { rows } = await client.query<{ uid: string }>(`select auth.uid()::text as uid`);
      await client.query("rollback");
      assert.equal(rows[0]!.uid, dirigeant.id);
    } finally {
      client.release();
    }
  });

  it("émettre écrit une ligne par destinataire, remise, lisible au centre", async () => {
    const { rows } = await admin.query<{ n: number }>(
      `select notif.emettre($1, 'piece.partagee', '{"piece_id": null}'::jsonb) as n`,
      [pme],
    );
    assert.equal(
      rows[0]!.n,
      4,
      "le dirigeant, le comptable interne, le cabinet engagé et son collaborateur affecté — ni le tiers, ni un collaborateur non affecté",
    );

    const duDirigeant = await centre(dirigeant, [pme]);
    const ducabinet = await centre(expert, [pme]);
    const dutiers = await centre(tiers, [pme]);
    assert.ok(duDirigeant.some((n) => n.kind === "piece.partagee" && n.read_at === null));
    assert.ok(ducabinet.some((n) => n.kind === "piece.partagee"));
    assert.equal(dutiers.length, 0, "le tiers ne lit rien de cette société");
  });

  it("chaque ligne app est remise : l'application est le centre même", async () => {
    const { rows } = await admin.query<{ etat: string; n: string }>(
      `select etat, count(*) as n from notif.envois_v
        where tenant_id = $1 and canal = 'app' group by etat`,
      [pme],
    );
    assert.deepEqual(
      rows.map((r) => r.etat),
      ["remis"],
    );
  });

  it("l'accès perdu cache le centre", async () => {
    await admin.query(`select notif.emettre($1, 'mandat.accepte', '{}'::jsonb)`, [pme]);
    assert.ok((await centre(expert, [pme])).some((n) => n.kind === "mandat.accepte"));
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.revoquerMandat(db, pme, "fin de la mission, épreuve du moteur"),
    );
    assert.equal((await centre(expert, [pme])).length, 0, "le cabinet lit encore ce dossier");
    assert.ok((await centre(dirigeant, [pme])).length > 0, "le dirigeant a perdu le sien");
  });
});
