/**
 * Le mandat se lit et se révoque depuis la PME (19 octobre 2026).
 *
 * « Voir le mandat » et « Révoquer » étaient deux boutons éteints dans les
 * réglages de la PME. La règle de sortie est celle des scénarios D : le
 * dirigeant met fin seul, avec un motif ; la comptabilité perd l'accès le jour
 * même, et le lit à son journal.
 *
 * Et la retenue à la source d'un règlement trouve ses taux et son seuil au
 * référentiel daté — jamais dans le code.
 *
 *   node --experimental-strip-types --test src/le-mandat-se-lit-et-se-revoque.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le mandat se lit et se révoque depuis la PME", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `revoque-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}R/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";

  const creerOrganisation = (
    u: Utilisateur,
    kind: "pme" | "cabinet",
    nom: string,
    mf: string | null,
  ) =>
    sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization($1, $2, $3, $4, $5, $6) as id`,
        [kind, nom, "autonome", mf, "TN", "TND"],
      );
      return rows[0]!.id;
    });

  const piecesVuesParLExpert = () =>
    sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query(`select id from capture.pieces where tenant_id = $1`, [pme]);
      return rows.length;
    });

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    pme = await creerOrganisation(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creerOrganisation(expert, "cabinet", `COMPTA ${marque}`, null);
    await sousIdentite(dirigeant.id, (db) =>
      db.query(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'partage', $2, $3)`,
        [pme, `essai/${marque}.pdf`, marque],
      ),
    );
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
  });

  after(async () => {
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (admin) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = any($1::uuid[]) and archived_at is null`,
          [[pme, cabinet].filter(Boolean)],
        );
      } finally {
        await pool.end();
      }
    }
    await fermerLePool();
  });

  it("proposé, le mandat se lit, et ne se révoque pas encore", async () => {
    const m = await sousIdentite(dirigeant.id, (db) => identite.monMandat(db, pme));
    assert.ok(m);
    assert.equal(m.statut, "propose");
    assert.equal(m.comptabilite, `COMPTA ${marque}`);
    assert.equal(m.revocable, false);
  });

  it("actif, il se lit avec sa date, et le dirigeant peut le révoquer", async () => {
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    const m = await sousIdentite(dirigeant.id, (db) => identite.monMandat(db, pme));
    assert.equal(m?.statut, "actif");
    assert.match(m!.depuis, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(m?.revocable, true);
    assert.equal(await piecesVuesParLExpert(), 1);
  });

  it("l'expert ne révoque pas à la place du dirigeant", async () => {
    await assert.rejects(
      sousIdentite(expert.id, (db) => identite.revoquerMandat(db, pme, "essai")),
    );
  });

  it("sans motif, la révocation est refusée", async () => {
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) => identite.revoquerMandat(db, pme, "  ")),
      /pourquoi/i,
    );
  });

  it("révoqué : la comptabilité ne lit plus rien, et le motif est aux deux journaux", async () => {
    const r = await sousIdentite(dirigeant.id, (db) =>
      identite.revoquerMandat(db, pme, "Je change de comptable"),
    );
    assert.equal(r.statut, "termine");
    assert.equal(await piecesVuesParLExpert(), 0);
    assert.equal(await sousIdentite(dirigeant.id, (db) => identite.monMandat(db, pme)), null);

    const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      const { rows } = await pool.query<{ tenant_id: string; motif: string }>(
        `select tenant_id, payload ->> 'motif' as motif from audit.event_log
          where action = 'engagement.revoque' and object_id = $1`,
        [r.id],
      );
      assert.deepEqual(new Set(rows.map((x) => x.tenant_id)), new Set([pme, cabinet]));
      assert.ok(rows.every((x) => x.motif === "Je change de comptable"));
    } finally {
      await pool.end();
    }
  });

  it("une seconde révocation dit qu'il n'y a plus rien à révoquer", async () => {
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) => identite.revoquerMandat(db, pme, "encore")),
      /Aucun mandat actif/,
    );
  });

  it("les taux de retenue d'un règlement viennent du référentiel daté, avec leur seuil", async () => {
    const taux = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ code: string; taux: string; seuil: string }>(
        `select code, taux::text, seuil::text from ref.retenues_au_reglement('TN', date '2026-10-19')`,
      );
      return rows;
    });
    assert.ok(taux.length >= 1, "au moins le taux de l'article 52-I-g");
    assert.equal(taux[0]!.code, "RAS_MARCHES_ACQUISITIONS");
    assert.ok(
      taux.filter((t) => t.code.startsWith("RAS_MARCHES")).every((t) => Number(t.seuil) > 0),
      "les acquisitions ont leur seuil",
    );
    assert.ok(
      taux.some(
        (t) => t.code === "RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS" && t.seuil === null,
      ),
      "les honoraires n'en ont pas",
    );
    // Avant la constatation du référentiel, rien : la résolution échoue plutôt
    // qu'elle n'approxime.
    const avant = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query(
        `select * from ref.retenues_au_reglement('TN', date '2025-06-01')`,
      );
      return rows.length;
    });
    assert.equal(avant, 0);
  });
});
