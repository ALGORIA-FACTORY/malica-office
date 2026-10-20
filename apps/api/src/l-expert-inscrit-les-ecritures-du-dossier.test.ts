/**
 * L'expert mandaté inscrit les écritures du dossier (20 octobre 2026).
 *
 * Recette : le cabinet ne pouvait créer AUCUNE écriture nouvelle — règlement,
 * retenue, réimputation — « new row violates row-level security policy ».
 * Et forcer une imputation contre-passait sans réimputer : la facture sortait
 * des livres.
 *
 *   node --experimental-strip-types --test src/l-expert-inscrit-les-ecritures-du-dossier.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("l'expert mandaté inscrit les écritures du dossier", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `expert-ecrit-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}R/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let piece = "";
  let pack = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const lignes = (compte: string) => [
    { account_code: compte, libelle: "Achat", debit: "100.000", credit: "0", tax_code: null },
    { account_code: "401", libelle: "Fournisseur", debit: "0", credit: "100.000", tax_code: null },
  ];

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, $5, $6) as id`,
          [kind, nom, "autonome", mf, "TN", "TND"],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    piece = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}.pdf`, marque, dirigeant.id],
      );
      return rows[0]!.id;
    });
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    const { rows } = await admin.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    pack = rows[0]!.id;
  });

  after(async () => {
    try {
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

  it("l'expert propose et comptabilise une écriture dans le dossier de son client", async () => {
    const id = await sousIdentite(expert.id, async (db) => {
      const n = await office.propose(db, {
        pieceId: piece,
        journal: "ACH",
        date: "2026-10-20",
        libelle: "Facture essai",
        packVersionId: pack,
        devise: "TND",
        lignes: lignes("601"),
      });
      await office.book(db, n);
      return n;
    });
    const { rows } = await admin.query(`select status from socle.ecritures where id = $1`, [id]);
    assert.equal(rows[0]?.status, "booked");
  });

  it("forcer l'imputation contre-passe ET réimpute, en une transaction", async () => {
    const { rows: avant } = await admin.query<{ id: string }>(
      `select id from socle.ecritures where piece_id = $1 and status = 'booked'
        and reverses_id is null order by created_at desc limit 1`,
      [piece],
    );
    const { rows: motifs } = await admin.query<{ id: string }>(
      `select id from ref.rejet_motifs order by requires_note limit 1`,
    );
    const nouvelle = await sousIdentite(expert.id, (db) =>
      office.corrigerLImputation(db, {
        ecritureId: avant[0]!.id,
        motifId: motifs[0]!.id,
        note: "Honoraires : 622",
        libelle: "Facture essai réimputée",
        lignes: lignes("622"),
      }),
    );
    const { rows } = await admin.query<{ n: string }>(
      `select count(*)::text as n from socle.ecritures where piece_id = $1 and status = 'booked'`,
      [piece],
    );
    assert.equal(rows[0]?.n, "3", "l'erreur, son annulation, la correction");
    const { rows: c } = await admin.query<{ account_code: string }>(
      `select account_code from socle.ecriture_lignes where ecriture_id = $1 order by ordinal`,
      [nouvelle],
    );
    assert.deepEqual(
      c.map((x) => x.account_code),
      ["622", "401"],
    );
  });

  it("une réimputation refusée n'écrit rien : pas de contre-passation orpheline", async () => {
    const { rows: courante } = await admin.query<{ id: string }>(
      `select id from socle.ecritures where piece_id = $1 and status = 'booked'
        and reverses_id is null order by created_at desc limit 1`,
      [piece],
    );
    const { rows: motifs } = await admin.query<{ id: string }>(
      `select id from ref.rejet_motifs order by requires_note limit 1`,
    );
    const compter = async () =>
      (
        await admin.query<{ n: string }>(
          `select count(*)::text as n from socle.ecritures where piece_id = $1`,
          [piece],
        )
      ).rows[0]!.n;
    const avant = await compter();
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        office.corrigerLImputation(db, {
          ecritureId: courante[0]!.id,
          motifId: motifs[0]!.id,
          note: "déséquilibrée",
          libelle: "Déséquilibrée",
          lignes: [
            { account_code: "622", libelle: "x", debit: "100.000", credit: "0", tax_code: null },
            { account_code: "401", libelle: "y", debit: "0", credit: "90.000", tax_code: null },
          ],
        }),
      ),
    );
    assert.equal(await compter(), avant);
  });
});
