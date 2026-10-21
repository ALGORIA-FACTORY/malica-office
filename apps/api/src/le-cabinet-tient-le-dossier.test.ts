/**
 * Le cabinet tient le dossier, l'expert décide du calendrier, un mandat à la
 * fois (21 octobre 2026). Campagne de validation : ANO-008, ANO-012, ANO-014.
 *
 *   node --experimental-strip-types --test src/le-cabinet-tient-le-dossier.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { banque } from "./depots/banque.ts";
import { identite } from "./depots/identite.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le cabinet tient le dossier", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `tient-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}T/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let collaborateur: Utilisateur;
  let autreExpert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let autreCabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  before(async () => {
    const mdp = "MotDePasseTresLong2026!";
    const [d, e, c, a] = await Promise.all([
      creerCompte(`dirigeant-${marque}@essai.local`, mdp),
      creerCompte(`expert-${marque}@essai.local`, mdp),
      creerCompte(`collab-${marque}@essai.local`, mdp),
      creerCompte(`autre-${marque}@essai.local`, mdp),
    ]);
    assert.ok(d && e && c && a);
    dirigeant = d;
    expert = e;
    collaborateur = c;
    autreExpert = a;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, $5, $6) as id`,
          [kind, nom, "mandate", mf, "TN", "TND"],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    autreCabinet = await creer(autreExpert, "cabinet", `AUTRE ${marque}`, null);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [cabinet, collaborateur.id],
    );
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet, autreCabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("ANO-008 : l'expert mandaté ouvre un compte bancaire du dossier", async () => {
    const id = await sousIdentite(expert.id, (db) =>
      banque.createAccount(db, {
        tenantId: pme,
        entityId: null,
        label: "Banque essai",
        devise: "TND",
        accountCode: "532",
      }),
    );
    const vu = await sousIdentite(dirigeant.id, (db) => banque.listAccounts(db, pme));
    assert.ok(
      vu.some((c: { id: string }) => c.id === id),
      "la société voit le compte",
    );
  });

  it("ANO-008 : un expert sans mandat, non", async () => {
    await assert.rejects(
      sousIdentite(autreExpert.id, (db) =>
        banque.createAccount(db, {
          tenantId: pme,
          entityId: null,
          label: "Intrus",
          devise: "TND",
          accountCode: "532",
        }),
      ),
    );
  });

  it("ANO-012 : un collaborateur ne reporte pas une échéance ; l'expert ne l'avance pas", async () => {
    const { rows } = await admin.query<{ code: string }>(
      `select code from ref.fiscal_obligations where jurisdiction = 'TN' order by code limit 1`,
    );
    const code = rows[0]!.code;
    await assert.rejects(
      sousIdentite(collaborateur.id, (db) =>
        db.query(
          `select public.cabinet_report_poser($1, $2, '2026-11', '2026-12-31', 'essai', null)`,
          [cabinet, code],
        ),
      ),
      /Seul l'expert/,
    );
    await assert.rejects(
      sousIdentite(collaborateur.id, (db) =>
        db.query(
          `insert into collab.reports_echeance_cabinet (tenant_id, obligation_code, periode, nouvelle_date, motif)
           values ($1, $2, '2026-11', '2026-12-31', 'en direct')`,
          [cabinet, code],
        ),
      ),
      /row-level security|niveau ligne/,
    );
    await admin.query(
      `insert into schedule.echeances (tenant_id, kind, label, period, due_date, date_legale, pack_version_id)
       select $1, $2, 'Essai', '2026-11', '2026-12-15', '2026-12-15',
              (select id from ref.jurisdiction_packs where jurisdiction = 'TN'
                order by effective_from desc limit 1)`,
      [pme, code],
    );
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        db.query(
          `select public.cabinet_report_poser($1, $2, '2026-11', '2026-12-01', 'essai', null)`,
          [cabinet, code],
        ),
      ),
      /avant sa date légale/,
    );
    await sousIdentite(expert.id, (db) =>
      db.query(
        `select public.cabinet_report_poser($1, $2, '2026-11', '2026-12-31', 'essai', null)`,
        [cabinet, code],
      ),
    );
  });

  it("ANO-012 : le calendrier du cabinet se règle par l'expert seul", async () => {
    const { rows } = await admin.query<{ code: string }>(
      `select code from ref.fiscal_obligations where jurisdiction = 'TN' order by code limit 1`,
    );
    const code = rows[0]!.code;
    const regler = (u: Utilisateur) =>
      sousIdentite(u.id, (db) =>
        db.query(`select public.cabinet_obligation_definir($1, $2, 2026, '*', false, 7)`, [
          cabinet,
          code,
        ]),
      );
    await assert.rejects(regler(collaborateur), /Seul l'expert/);
    await regler(expert);
  });

  it("ANO-014 : une société n'a qu'une comptabilité mandatée à la fois", async () => {
    await sousIdentite(autreExpert.id, (db) => identite.proposerMandat(db, autreCabinet, legalId));
    const proposes = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    const second = proposes.find((p: { id: string }) => p.id);
    assert.ok(second);
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, second.id, true)),
      /déjà une comptabilité mandatée/,
    );
  });
});
