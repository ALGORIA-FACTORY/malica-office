/**
 * Un impayé suspend la lecture, la transmission ET l'export (22 octobre 2026).
 *
 * Décision de Wissem Barouni : « Suspendre la lecture, la transmission au
 * cabinet et l'export. » La transmission était tenue deux fois, en phrase
 * française ; elle l'est une fois, sur la table, et lève une clé. L'export
 * est nouveau : le cabinet n'exporte pas le dossier d'un client suspendu, et
 * l'export de tous les dossiers le laisse dehors.
 *
 *   node --experimental-strip-types --test src/un-impaye-suspend-transmission-et-export.test.ts
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

describe("un impayé suspend la transmission et l'export", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `impaye-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}S/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const statut = (s: "active" | "suspendue") =>
    admin.query(
      `update facturation.licences l
          set statut = $2, suspendue_le = case when $2 = 'active' then null else now() end
         from facturation.licence_organisations lo
        where lo.licence_id = l.id and lo.tenant_id = $1`,
      [pme, s],
    );

  const exporter = (client: string | null) =>
    sousIdentiteDuServeur(expert.id, async (db) => {
      const { rows } = await db.query<{ client_tenant_id: string }>(
        `select client_tenant_id
           from public.export_lignes_lire($1, $2, '2026-01-01', '2026-12-31')`,
        [cabinet, client],
      );
      return rows;
    });

  const deposerTransmise = (cle: string) =>
    sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by)
         values ($1, 'pdf', 'partage', $2, $3, $4)`,
        [pme, `essai/${cle}.pdf`, cle, dirigeant.id],
      ),
    );

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
    const { rows } = await admin.query(
      `select 1 from facturation.licence_organisations where tenant_id = $1`,
      [pme],
    );
    assert.equal(rows.length, 1, "la PME d'essai porte une licence");
  });

  after(async () => {
    try {
      await statut("active");
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

  it("licence active : la pièce part, et le dossier s'exporte", async () => {
    await deposerTransmise(`${marque}-actif`);
    await exporter(pme);
  });

  it("licence suspendue : rien ne part, la base dit pourquoi par une clé", async () => {
    await statut("suspendue");
    try {
      await assert.rejects(deposerTransmise(`${marque}-suspendu`), /refus\.licence\.transmission/);
    } finally {
      await statut("active");
    }
  });

  it("licence suspendue : le dossier du client ne s'exporte pas", async () => {
    await statut("suspendue");
    try {
      await assert.rejects(exporter(pme), /refus\.licence\.export/);
    } finally {
      await statut("active");
    }
  });

  it("licence suspendue : l'export de tous les dossiers le laisse dehors", async () => {
    await statut("suspendue");
    try {
      const lignes = await exporter(null);
      assert.ok(lignes.every((l) => l.client_tenant_id !== pme));
    } finally {
      await statut("active");
    }
  });
});
