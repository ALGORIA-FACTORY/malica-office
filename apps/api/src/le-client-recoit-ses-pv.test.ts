import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { collab } from "./depots/collab.ts";

const BASE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);
describe("un livrable publié appartient à son client", { skip: !BASE }, () => {
  const marque = `livrable-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let tiers: Utilisateur;
  let pme = "";
  let cabinet = "";
  let pv = "";
  let brouillon = "";
  const lire = (u: Utilisateur, id = pme) => sousIdentite(u.id, (db) => collab.pvDuClient(db, id));

  before(async () => {
    const mdp = "MotDePasseTresLong2026!";
    const [d, e, a] = await Promise.all([
      creerCompte(`${marque}-client@essai.local`, mdp),
      creerCompte(`${marque}-expert@essai.local`, mdp),
      creerCompte(`${marque}-tiers@essai.local`, mdp),
    ]);
    assert.ok(d && e && a);
    dirigeant = d;
    expert = e;
    tiers = a;
    const mf = `${String(Date.now()).slice(-7)}T/A/M/000`;
    const creer = (u: Utilisateur, kind: string, legal: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
          [kind, `${kind} ${marque}`, legal],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", mf);
    cabinet = await creer(expert, "cabinet", null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [m] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, m!.id, true));
    for (const titre of ["Document publié", "Brouillon interne"]) {
      const id = await sousIdentite(expert.id, (db) =>
        collab.addPv(db, {
          cabinetTenantId: cabinet,
          clientTenantId: pme,
          at: "2026-10-22",
          titre,
        }),
      );
      await sousIdentite(expert.id, (db) =>
        collab.pvEnregistrer(db, {
          id,
          sections: [{ kicker: "Suivi", corps: "Pièces à compléter." }],
        }),
      );
      if (titre === "Document publié") {
        pv = id;
        await sousIdentite(expert.id, (db) => collab.pvEnvoyer(db, id));
      } else brouillon = id;
    }
  });
  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé' where id = any($1::uuid[])`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("le client ne reçoit que le document publié, le tiers ne reçoit rien", async () => {
    const docs = await lire(dirigeant);
    assert.deepEqual(
      docs.map((d) => d.document.id),
      [pv],
    );
    assert.equal(docs[0]!.recuLe, null);
    assert.deepEqual(await lire(tiers), []);
    await assert.rejects(sousIdentite(tiers.id, (db) => collab.pvAccuserReception(db, pv)));
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) => collab.pvAccuserReception(db, brouillon)),
    );
  });
  it("la réception est explicite, idempotente et journalisée sans modifier le PV", async () => {
    const a = await sousIdentite(dirigeant.id, (db) => collab.pvAccuserReception(db, pv));
    const b = await sousIdentite(dirigeant.id, (db) => collab.pvAccuserReception(db, pv));
    assert.equal(new Date(a).toISOString(), new Date(b).toISOString());
    const docs = await lire(dirigeant);
    assert.ok(docs[0]!.recuLe);
    assert.equal(docs[0]!.document.statut, "envoye");
    const { rows } = await admin.query(
      `select count(*)::int as n from audit.event_log where action = 'pv.recu' and payload->>'pv_id' = $1`,
      [pv],
    );
    assert.equal(rows[0].n, 2);
    assert.equal((await sousIdentite(expert.id, (db) => collab.pvReceptions(db, pv))).length, 1);
    assert.deepEqual(await sousIdentite(tiers.id, (db) => collab.pvReceptions(db, pv)), []);
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) =>
        db.query(`update collab.pv_receptions set recu_le = now() where pv_id = $1`, [pv]),
      ),
    );
  });
  it("le cumul d'un PV se date quand ses chiffres s'écrivent ; sans chiffres, il ne se date pas", async () => {
    const id = await sousIdentite(expert.id, (db) =>
      collab.addPv(db, {
        cabinetTenantId: cabinet,
        clientTenantId: pme,
        at: "2026-11-05",
        titre: "Cumul",
      }),
    );
    const texte = await sousIdentite(expert.id, (db) =>
      collab.pvEnregistrer(db, { id, sections: [{ kicker: "Suivi", corps: "Texte." }] }),
    );
    assert.equal(texte.arrete, null);
    const chiffre = await sousIdentite(expert.id, (db) =>
      collab.pvEnregistrer(db, {
        id,
        chiffres: [{ label: "pieces", valeur: "3", source: "file", genre: "nombre", devise: null }],
      }),
    );
    assert.equal(chiffre.arrete, "2026-11-05");

    // Un PV d'avant, rédigé de nouveau avec les MÊMES montants (staging, le
    // soir du 5 novembre 2026) : le jour s'écrit quand même.
    await admin.query(`update collab.pv_reunions set arrete = null where id = $1`, [id]);
    const memes = await sousIdentite(expert.id, (db) =>
      collab.pvEnregistrer(db, {
        id,
        chiffres: [{ label: "pieces", valeur: "3", source: "file", genre: "nombre", devise: null }],
      }),
    );
    assert.equal(memes.arrete, "2026-11-05");
  });

  it("le client conserve son livrable après la fin du mandat", async () => {
    await sousIdentite(dirigeant.id, (db) =>
      identite.revoquerMandat(db, pme, "Fin de la mission d'essai"),
    );
    assert.deepEqual(
      (await lire(dirigeant)).map((d) => d.document.id),
      [pv],
    );
    assert.deepEqual(await lire(tiers), []);
  });
});
