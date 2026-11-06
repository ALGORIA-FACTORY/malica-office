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
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
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
    { account_code: compte, libelle: "Achat", debit: "100.000", credit: "0", tax_code: "EXO" },
    { account_code: "401", libelle: "Fournisseur", debit: "0", credit: "100.000", tax_code: null },
  ];

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
    piece = await sousIdentiteDuServeur(dirigeant.id, async () => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}.pdf`, marque, dirigeant.id],
      );
      return rows[0]!.id;
    });
    await sousIdentiteDuServeur(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.mandatsProposes(db, pme),
    );
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );
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
    const id = await sousIdentiteDuServeur(expert.id, async (db) => {
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
    const nouvelle = await sousIdentiteDuServeur(expert.id, (db) =>
      office.forcer(db, {
        pieceId: piece,
        journal: "ACH",
        date: "2026-10-20",
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

  it("une facture contre-passée sans réimputation sort de la TVA du mois", async () => {
    const autre = await sousIdentiteDuServeur(dirigeant.id, async () => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}-b.pdf`, `${marque}-b`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    await admin.query(
      `insert into capture.extractions (tenant_id, piece_id, contract, payload)
       values ($1, $2, 'extract.v1', '{}'::jsonb)`,
      [pme, autre],
    );
    const ecr = await sousIdentiteDuServeur(expert.id, async (db) => {
      const n = await office.propose(db, {
        pieceId: autre,
        journal: "ACH",
        date: "2026-10-20",
        libelle: "Facture à retourner",
        packVersionId: pack,
        devise: "TND",
        lignes: lignes("601"),
      });
      await office.book(db, n);
      return n;
    });
    // Les extraits COMPTABILISÉS sont la lecture du cabinet : en mandat, la
    // PME ne voit jamais les écritures (lot S2), et sa TVA du mois passe par
    // `extraitsTransmis`, plus bas.
    const avant = await sousIdentiteDuServeur(expert.id, (db) =>
      office.bookedExtracts(db, pme, "2026-10-01", "2026-10-31"),
    );
    assert.ok(
      avant.some((x) => x.pieceId === autre),
      "comptabilisée : elle compte",
    );

    const { rows: motifs } = await admin.query<{ id: string }>(
      `select id from ref.rejet_motifs where usage = 'retour' order by requires_note limit 1`,
    );
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.socle_ecriture_review($1, 'retourne', $2, 'à reprendre')`, [
        ecr,
        motifs[0]!.id,
      ]),
    );
    const apres = await sousIdentiteDuServeur(expert.id, (db) =>
      office.bookedExtracts(db, pme, "2026-10-01", "2026-10-31"),
    );
    assert.ok(!apres.some((x) => x.pieceId === autre), "contre-passée : elle ne compte plus");
    const transmises = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      office.extraitsTransmis(db, pme, "2026-01-01", "2099-12-31"),
    );
    assert.ok(!transmises.some((x) => x.pieceId === autre), "retournée : hors déclaration");
  });

  it("la TVA d'une facture se range au mois de son écriture, des deux côtés, même transmise plus tard", async () => {
    const sept = await sousIdentiteDuServeur(dirigeant.id, async () => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}-sept.pdf`, `${marque}-sept`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    await admin.query(
      `insert into capture.extractions (tenant_id, piece_id, contract, payload)
       values ($1, $2, 'extract.v1', '{}'::jsonb)`,
      [pme, sept],
    );
    await sousIdentiteDuServeur(expert.id, async (db) => {
      const n = await office.propose(db, {
        pieceId: sept,
        journal: "ACH",
        date: "2026-09-10",
        libelle: "Facture de septembre",
        packVersionId: pack,
        devise: "TND",
        lignes: lignes("601"),
      });
      await office.book(db, n);
    });
    const vus = async (from: string, to: string) => {
      const pme_ = await sousIdentiteDuServeur(dirigeant.id, (db) =>
        office.extraitsTransmis(db, pme, from, to),
      );
      // Le côté du cabinet se lit sous son identité : la PME ne voit jamais
      // les écritures (lot S2).
      const cab = await sousIdentiteDuServeur(expert.id, (db) =>
        office.bookedExtracts(db, pme, from, to),
      );
      return [pme_.some((x) => x.pieceId === sept), cab.some((x) => x.pieceId === sept)];
    };
    // Transmise aujourd'hui, datée du 10/09 : septembre, des deux côtés.
    assert.deepEqual(await vus("2026-09-01", "2026-09-30"), [true, true]);
    const aujourdHui = (
      await admin.query<{ m: string }>(`select to_char(current_date, 'YYYY-MM') as m`)
    ).rows[0]!.m;
    if (aujourdHui !== "2026-09")
      assert.deepEqual(await vus(`${aujourdHui}-01`, `${aujourdHui}-28`), [false, false]);
  });

  it("une réimputation refusée n'écrit rien : pas de contre-passation orpheline", async () => {
    const compter = async () =>
      (
        await admin.query<{ n: string }>(
          `select count(*)::text as n from socle.ecritures where piece_id = $1`,
          [piece],
        )
      ).rows[0]!.n;
    const avant = await compter();
    // Équilibrée, mais sur un compte hors du plan : la base refuse APRÈS la
    // contre-passation, et la transaction emporte les deux.
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) =>
        office.forcer(db, {
          pieceId: piece,
          journal: "ACH",
          date: "2026-10-20",
          libelle: "Hors du plan",
          lignes: [
            { account_code: "999999", libelle: "x", debit: "100.000", credit: "0", tax_code: null },
            { account_code: "401", libelle: "y", debit: "0", credit: "100.000", tax_code: null },
          ],
        }),
      ),
    );
    assert.equal(await compter(), avant);
  });

  it("le FEC du cabinet nomme le fournisseur sur la ligne 401, et seulement là", async () => {
    // Recette du 20 octobre 2026 : CompAuxNum / CompAuxLib vides.
    await admin.query(
      `insert into capture.extractions (tenant_id, piece_id, contract, payload)
       values ($1, $2, 'extract.v1', $3::jsonb)`,
      [
        pme,
        piece,
        JSON.stringify({
          issuer: "PAPETERIE NOUR",
          document_date: "2026-10-20",
          references: { numero: "PN-1", matricule_fiscal: "0914089j/a/m/000" },
        }),
      ],
    );
    const lignesFec = await sousIdentiteDuServeur(expert.id, async (db) => {
      // Seules les écritures de CETTE pièce : les épreuves précédentes en ont
      // inscrit d'autres, sans lecture, donc sans tiers.
      const { rows } = await db.query<{
        compte: string;
        tiers_num: string | null;
        tiers_lib: string | null;
      }>(
        `select compte, tiers_num, tiers_lib
           from public.export_lignes_lire($1, $2, '2026-01-01', '2026-12-31')
          where piece_ref = 'PN-1'`,
        [cabinet, pme],
      );
      return rows;
    });
    assert.ok(lignesFec.length > 0, "le dossier a des écritures");
    for (const l of lignesFec) {
      if (l.compte === "401") {
        assert.equal(l.tiers_num, "0914089J/A/M/000");
        assert.equal(l.tiers_lib, "PAPETERIE NOUR");
      } else {
        assert.equal(l.tiers_num, null, `pas de tiers sur ${l.compte}`);
      }
    }
  });
});
