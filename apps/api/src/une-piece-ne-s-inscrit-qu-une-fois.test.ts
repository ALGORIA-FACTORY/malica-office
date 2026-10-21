/**
 * Une pièce ne s'inscrit qu'une fois ; un règlement non plus (21 octobre 2026).
 *
 * Campagne de validation du 21 octobre : ANO-004 (deux écritures
 * comptabilisées pour une facture), ANO-006 (quatre clics, quatre écritures
 * de règlement, toutes « proposées », aucune au FEC), ANO-009 (une pièce
 * confirmée puis transmise laissait son écriture invisible au cabinet).
 *
 *   node --experimental-strip-types --test src/une-piece-ne-s-inscrit-qu-une-fois.test.ts
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

describe("une pièce ne s'inscrit qu'une fois", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `une-fois-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}U/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let pack = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const lignes = (compte: string) => [
    { account_code: compte, libelle: "Achat", debit: "100.000", credit: "0", tax_code: null },
    { account_code: "401", libelle: "Fournisseur", debit: "0", credit: "100.000", tax_code: null },
  ];
  const facture = (pieceId: string, compte = "601") => ({
    pieceId,
    journal: "ACH",
    date: "2026-10-20",
    libelle: "Facture essai",
    packVersionId: pack,
    devise: "TND",
    lignes: lignes(compte),
  });
  let n = 0;
  const nouvellePiece = (vis: "partage" | "entite") =>
    sousIdentite(dirigeant.id, async (db) => {
      n += 1;
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', $5::app.vis_t, $2, $3, $4, 'facture_achat', 'confirme',
                 case when $5 = 'partage' then now() end) returning id`,
        [pme, `essai/${marque}-${n}.pdf`, `${marque}-${n}`, dirigeant.id, vis],
      );
      return rows[0]!.id;
    });
  const vivantes = async (pieceId: string, nature: string) =>
    (
      await admin.query<{ n: string }>(
        `select count(*)::text as n from socle.ecritures e
          where e.piece_id = $1 and e.nature = $2 and app.ecriture_vivante(e.id)`,
        [pieceId, nature],
      )
    ).rows[0]!.n;

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

  it("ANO-004 : une pièce inscrite refuse une seconde écriture, proposée ou comptabilisée", async () => {
    const piece = await nouvellePiece("partage");
    await sousIdentite(expert.id, async (db) => {
      const id = await office.propose(db, facture(piece));
      await office.book(db, id);
    });
    await assert.rejects(
      sousIdentite(expert.id, (db) => office.propose(db, facture(piece, "622"))),
      /déjà inscrite/,
    );
    assert.equal(await vivantes(piece, "piece"), "1");
  });

  it("ANO-004 : deux propositions de l'expert n'en laissent qu'une, et une seule s'inscrit", async () => {
    const piece = await nouvellePiece("partage");
    const [a, b] = await sousIdentite(expert.id, async (db) => [
      await office.propose(db, facture(piece)),
      await office.propose(db, facture(piece, "622")),
    ]);
    const { rows } = await admin.query<{ id: string }>(
      `select id from socle.ecritures where piece_id = $1 and status = 'proposee'`,
      [piece],
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [b],
      "la seconde remplace la première",
    );
    assert.notEqual(a, b);
    await sousIdentite(expert.id, (db) => office.book(db, b!));
    assert.equal(await vivantes(piece, "piece"), "1");
  });

  it("ANO-004 : une écriture contre-passée ne se retourne pas une seconde fois", async () => {
    const piece = await nouvellePiece("partage");
    const ecr = await sousIdentite(expert.id, async (db) => {
      const id = await office.propose(db, facture(piece));
      await office.book(db, id);
      return id;
    });
    const { rows: motifs } = await admin.query<{ id: string }>(
      `select id from ref.rejet_motifs order by requires_note limit 1`,
    );
    const retourner = () =>
      sousIdentite(expert.id, (db) =>
        db.query(`select public.socle_ecriture_review($1, 'retourne', $2, 'à reprendre')`, [
          ecr,
          motifs[0]!.id,
        ]),
      );
    await retourner();
    await assert.rejects(retourner(), /déjà contre-passée/);
    // Retournée : la pièce se réimpute, une fois.
    await sousIdentite(expert.id, async (db) => {
      const id = await office.propose(db, facture(piece, "622"));
      await office.book(db, id);
    });
    assert.equal(await vivantes(piece, "piece"), "1");
  });

  it("ANO-006 : inscrire un règlement le comptabilise, une fois, sans toucher la facture", async () => {
    const piece = await nouvellePiece("partage");
    await sousIdentite(expert.id, async (db) => {
      const id = await office.propose(db, facture(piece));
      await office.book(db, id);
    });
    const { rows: moyens } = await admin.query<{ code: string }>(
      `select code from public.ref_payment_means_v
        where pack_version_id = $1 and journal_code is not null and tresorerie_account is not null
        order by code limit 1`,
      [pack],
    );
    assert.ok(moyens[0], "le pack porte un moyen de paiement");
    const { rows: p } = await admin.query<{ id: string }>(
      `insert into capture.paiements (tenant_id, vis, piece_id, moyen_code, pack_version_id,
                                      montant_mineur, devise, paye_le)
       values ($1, 'partage', $2, $3, $4, 100000, 'TND', '2026-10-21') returning id`,
      [pme, piece, moyens[0]!.code, pack],
    );
    const paiement = p[0]!.id;

    const avant = await sousIdentite(expert.id, (db) =>
      office.propositionDeReglement(db, paiement),
    );
    assert.ok(avant.ok, avant.ok ? "" : avant.raison);
    assert.equal(avant.ok && avant.inscrite, null);

    const ids = await sousIdentite(expert.id, async (db) => [
      await office.inscrireLeReglement(db, paiement),
      await office.inscrireLeReglement(db, paiement),
    ]);
    assert.equal(ids[0], ids[1], "redemander rend la même écriture");
    const { rows: e } = await admin.query<{ status: string; nature: string }>(
      `select status, nature from socle.ecritures where id = $1`,
      [ids[0]],
    );
    assert.deepEqual(e[0], { status: "booked", nature: "reglement" });
    assert.equal(await vivantes(piece, "reglement"), "1");
    assert.equal(await vivantes(piece, "piece"), "1", "la facture reste inscrite");

    const apres = await sousIdentite(expert.id, (db) =>
      office.propositionDeReglement(db, paiement),
    );
    assert.equal(apres.ok && apres.inscrite?.ecritureId, ids[0]);
  });

  it("ANO-009 : transmettre une pièce transmet son écriture au cabinet", async () => {
    const piece = await nouvellePiece("entite");
    const ecr = await sousIdentite(dirigeant.id, (db) => office.propose(db, facture(piece)));
    const voit = () =>
      sousIdentite(expert.id, async (db) => {
        const { rows } = await db.query(`select 1 from ecritures_v where id = $1`, [ecr]);
        return rows.length === 1;
      });
    assert.equal(await voit(), false, "chez la société, le cabinet ne la voit pas");
    await sousIdentite(dirigeant.id, (db) =>
      db.query(`select public.capture_piece_set_vis($1, 'partage')`, [piece]),
    );
    assert.equal(await voit(), true, "transmise, son écriture l'est aussi");
    await sousIdentite(expert.id, (db) => office.book(db, ecr));
  });

  it("R7 : une écriture comptabilisée ne se supprime pas, même par la société", async () => {
    const piece = await nouvellePiece("partage");
    const ecr = await sousIdentite(expert.id, async (db) => {
      const id = await office.propose(db, facture(piece));
      await office.book(db, id);
      return id;
    });
    const supprimees = await sousIdentite(dirigeant.id, async (db) => {
      const r = await db.query(`delete from socle.ecritures where id = $1`, [ecr]);
      return r.rowCount;
    });
    assert.equal(supprimees, 0);
  });

  it("ANO-007 : le FEC ne porte que le transmis, et ValidDate attend la supervision", async () => {
    const transmise = await nouvellePiece("partage");
    const gardee = await nouvellePiece("entite");
    const ecr = await sousIdentite(expert.id, async (db) => {
      const id = await office.propose(db, { ...facture(transmise), libelle: `FEC ${marque}` });
      await office.book(db, id);
      return id;
    });
    await sousIdentite(dirigeant.id, async (db) => {
      const id = await office.propose(db, { ...facture(gardee), libelle: `GARDEE ${marque}` });
      await office.book(db, id);
    });
    const lire = () =>
      sousIdentite(expert.id, async (db) => {
        const { rows } = await db.query<{ ecriture_libelle: string; valide_le: string | null }>(
          `select ecriture_libelle, valide_le::text as valide_le
             from public.export_lignes_lire($1, $2, '2026-01-01', '2026-12-31')
            where ecriture_libelle in ($3, $4)`,
          [cabinet, pme, `FEC ${marque}`, `GARDEE ${marque}`],
        );
        return rows;
      });
    const avant = await lire();
    assert.ok(avant.length > 0);
    assert.ok(
      avant.every((l) => l.ecriture_libelle === `FEC ${marque}`),
      "la pièce gardée n'y est pas",
    );
    assert.ok(
      avant.every((l) => l.valide_le === null),
      "non supervisée : ValidDate vide",
    );

    await sousIdentite(expert.id, (db) =>
      db.query(`select public.socle_ecriture_review($1, 'valide')`, [ecr]),
    );
    const apres = await lire();
    const aujourdhui = (await admin.query<{ d: string }>(`select current_date::text as d`)).rows[0]!
      .d;
    assert.ok(
      apres.every((l) => l.valide_le === aujourdhui),
      "supervisée : la date de supervision",
    );
  });

  it("ANO-005 : seule une pièce confirmée, dans la société, sans doublon, compte", async () => {
    const confirmee = await nouvellePiece("partage");
    const lue = await nouvellePiece("partage");
    const doublon = await nouvellePiece("partage");
    const privee = await nouvellePiece("entite");
    await admin.query(`update capture.pieces set status = 'proposee' where id = any($1::uuid[])`, [
      [confirmee, doublon, privee],
    ]);
    await admin.query(`update capture.pieces set status = 'lue' where id = $1`, [lue]);
    await admin.query(`update capture.pieces set doublon_de = $1 where id = $2`, [
      confirmee,
      doublon,
    ]);
    await admin.query(`update capture.pieces set vis = 'personnel' where id = $1`, [privee]);
    for (const p of [confirmee, lue, doublon]) {
      await admin.query(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload)
         values ($1, $2, 'extract.v1', '{}'::jsonb)`,
        [pme, p],
      );
    }
    const comptent = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select id from pieces_qui_comptent_v where id = any($1::uuid[])`,
        [[confirmee, lue, doublon, privee]],
      );
      return rows.map((r) => r.id);
    });
    assert.deepEqual(comptent, [confirmee]);
    const transmis = await sousIdentite(dirigeant.id, (db) =>
      office.extraitsTransmis(db, pme, "2026-01-01", "2099-12-31"),
    );
    const ids = transmis.map((x) => x.pieceId);
    assert.ok(ids.includes(confirmee), "confirmée et transmise : elle compte");
    assert.ok(!ids.includes(lue), "transmise sans confirmation : elle attend");
    assert.ok(!ids.includes(doublon), "un doublon ne compte pas deux fois");
  });
});
