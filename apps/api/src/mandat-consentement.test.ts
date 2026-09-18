/**
 * Un mandat ne s'active qu'avec l'accord de la PME.
 *
 * La frontière cabinet ↔ PME est un mandat actif (`identity.engagements`) :
 * c'est lui qui ouvre au cabinet les pièces partagées de la PME
 * (`app.engaged_orgs`). Jusqu'au 18 septembre 2026, la politique d'insertion
 * n'exigeait que d'être expert du CABINET : un expert qui connaissait
 * l'identifiant fiscal d'une PME — imprimé sur chacune de ses factures —
 * obtenait son identifiant interne par `mandat_proposer`, puis insérait un
 * mandat « actif » lui-même (`identite.creerMandat`, exposé par /rpc), et
 * lisait. Et le même chemin réactivait un mandat que la PME avait terminé.
 *
 * Tout passe par `sousIdentite` et par les dépôts de l'API, comme une requête
 * réelle.
 *
 *   node --experimental-strip-types --test src/mandat-consentement.test.ts
 */

import assert from "node:assert/strict";
import pg from "pg";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("un mandat ne s'active qu'avec l'accord de la PME", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `essai-${Date.now()}`;
  const legalId = `MF-${marque}`;
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
    assert.ok(d && e, "les deux comptes doivent être créés");
    dirigeant = d;
    expert = e;
    pme = await creerOrganisation(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creerOrganisation(expert, "cabinet", `CABINET ${marque}`, null);
    // Une pièce PARTAGÉE : celle qu'un cabinet mandaté lirait.
    await sousIdentite(dirigeant.id, (db) =>
      db.query(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'partage', $2, $3)`,
        [pme, `essai/${marque}.pdf`, marque],
      ),
    );
  });

  after(async () => {
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (admin && (pme || cabinet)) {
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

  it("proposer ne donne rien à lire", async () => {
    const r = await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    assert.equal(r.status, "propose");
    assert.equal(await piecesVuesParLExpert(), 0);
  });

  it("l'expert ne peut pas activer lui-même le mandat proposé", async () => {
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        identite.creerMandat(db, { pmeOrgId: pme, cabinetOrgId: cabinet, status: "actif" }),
      ),
    );
    assert.equal(await piecesVuesParLExpert(), 0, "l'expert lit les pièces de la PME");
  });

  it("la PME accepte : l'expert lit la pièce partagée", async () => {
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    assert.ok(propose, "la PME voit le mandat proposé");
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose.id, true));
    assert.equal(await piecesVuesParLExpert(), 1);
  });

  it("la PME termine : l'expert ne peut pas réactiver le mandat", async () => {
    await sousIdentite(dirigeant.id, (db) =>
      db.query(`update engagements_v set status = 'termine' where pme_org_id = $1`, [pme]),
    );
    assert.equal(await piecesVuesParLExpert(), 0);
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        identite.creerMandat(db, { pmeOrgId: pme, cabinetOrgId: cabinet, status: "actif" }),
      ),
    );
    assert.equal(await piecesVuesParLExpert(), 0, "l'expert a réactivé un mandat terminé");
  });
});
