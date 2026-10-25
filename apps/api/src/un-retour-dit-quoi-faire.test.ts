/**
 * Un retour du cabinet dit quoi faire ; le cabinet a des gestes devant une
 * pièce que le client n'a pas confirmée (maquette validée le 25 octobre 2026).
 *
 *   node --experimental-strip-types --test src/un-retour-dit-quoi-faire.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { RetourDuCabinet } from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";
import { supervision } from "./depots/supervision.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("un retour dit quoi faire", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `retour-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}R/A/M/000`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let pack = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const motifs: Record<string, string> = {};

  let n = 0;
  /** Une pièce transmise, lue, que le client n'a pas confirmée. */
  const lue = async () => {
    n += 1;
    const id = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}-${n}.pdf`, `${marque}-${n}`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    await admin.query(`update capture.pieces set status = 'lue' where id = $1`, [id]);
    return id;
  };
  const statut = async (id: string) =>
    (await admin.query<{ s: string }>(`select status as s from capture.pieces where id = $1`, [id]))
      .rows[0]!.s;
  const retour = (id: string) =>
    sousIdentiteDuServeur(
      dirigeant.id,
      async (db) =>
        (await executerRpc(db, {
          depot: "capture",
          methode: "retourDeLaPiece",
          args: [id, "fr"],
        })) as RetourDuCabinet | null,
    );
  const repondre = (id: string, texte: string) =>
    sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "repondreAuCabinet", args: [id, texte] }),
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
    pack = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    for (const m of await sousIdentiteDuServeur(expert.id, (db) => supervision.motifs(db, "fr")))
      motifs[m.code] = m.id;
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

  it("chaque motif du référentiel dit le geste qu'il demande", async () => {
    const liste = await sousIdentiteDuServeur(expert.id, (db) => supervision.motifs(db, "fr"));
    assert.ok(liste.length > 0);
    for (const m of liste) assert.ok(m.geste, `${m.code} a un geste`);
    assert.equal(liste.find((m) => m.code === "justificatif_manquant")?.geste, "joindre_document");
  });

  it("le cabinet retourne une pièce lue ; la PME lit le motif, la note, le cabinet et le geste", async () => {
    const id = await lue();
    await sousIdentiteDuServeur(expert.id, (db) =>
      supervision.retourner(db, {
        pieceId: id,
        motifId: motifs["justificatif_manquant"]!,
        note: "Merci de joindre le bon de livraison BL-2210.",
      }),
    );
    assert.equal(await statut(id), "retournee");
    const r = await retour(id);
    assert.equal(r?.motif, "justificatif_manquant");
    assert.equal(r?.geste, "joindre_document");
    assert.equal(r?.note, "Merci de joindre le bon de livraison BL-2210.");
    assert.equal(r?.cabinet, `COMPTA ${marque}`);
    assert.equal(r?.fait, false, "rien n'est encore joint");

    // Le document joint APRÈS le retour : le geste est fait.
    const bl = await lue();
    await admin.query(
      `insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, auteur)
       values ($1, $2, $3, 'rattache', $4)`,
      [pme, id, bl, dirigeant.id],
    );
    assert.equal((await retour(id))?.fait, true);

    // Le geste fait, le client renvoie : son « Oui » inscrit l'écriture.
    await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const e = await office.propose(db, {
        pieceId: id,
        journal: "ACH",
        date: "2026-10-02",
        libelle: "Facture essai",
        packVersionId: pack,
        devise: "TND",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "100.000", credit: "0", tax_code: null },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "100.000",
            tax_code: null,
          },
        ],
      });
      await office.book(db, e);
    });
    assert.equal(await statut(id), "comptabilisee");
    assert.equal(await retour(id), null, "plus rien à reprendre");
  });

  it("une note est exigée quand le motif l'exige ; le client ne retourne rien lui-même", async () => {
    const id = await lue();
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) =>
        supervision.retourner(db, { pieceId: id, motifId: motifs["justificatif_manquant"]! }),
      ),
      /exige une note/,
    );
    await assert.rejects(
      sousIdentiteDuServeur(dirigeant.id, (db) =>
        supervision.retourner(db, { pieceId: id, motifId: motifs["doublon"]! }),
      ),
      /supervision revient/,
    );
    assert.equal(await statut(id), "lue");
  });

  it("une pièce inscrite ne se retourne pas par cette porte : elle a une écriture à contre-passer", async () => {
    const id = await lue();
    await admin.query(`update capture.pieces set status = 'comptabilisee' where id = $1`, [id]);
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) =>
        supervision.retourner(db, { pieceId: id, motifId: motifs["doublon"]! }),
      ),
      /refus\.retour\.inscrite/,
    );
  });

  it("relancer le client le notifie, et seulement sur une pièce lue", async () => {
    const id = await lue();
    await sousIdentiteDuServeur(expert.id, (db) => supervision.demanderConfirmation(db, id));
    const { rows } = await admin.query(
      `select 1 from collab.notifications
        where tenant_id = $1 and kind = 'piece.confirmation_demandee' and payload ->> 'piece_id' = $2`,
      [pme, id],
    );
    assert.equal(rows.length, 1);
    await admin.query(`update capture.pieces set status = 'retournee' where id = $1`, [id]);
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) => supervision.demanderConfirmation(db, id)),
      /refus\.confirmation\.sans_objet/,
    );
  });

  it("répondre au cabinet fait le geste « répondre », trace et notifie", async () => {
    const id = await lue();
    await sousIdentiteDuServeur(expert.id, (db) =>
      supervision.retourner(db, {
        pieceId: id,
        motifId: motifs["imputation_a_revoir"]!,
        note: "Charge ou immobilisation ?",
      }),
    );
    assert.equal((await retour(id))?.fait, false);
    await repondre(id, "C'est un ordinateur : immobilisation.");
    assert.equal((await retour(id))?.fait, true);
    await assert.rejects(repondre(id, "   "), /refus\.reponse\.vide/);
  });

  it("le cabinet inscrit lui-même l'écriture d'une pièce que le client n'a pas confirmée", async () => {
    const id = await lue();
    const ecr = await sousIdentiteDuServeur(expert.id, async (db) => {
      const e = await office.propose(db, {
        pieceId: id,
        journal: "ACH",
        date: "2026-10-02",
        libelle: "Facture essai",
        packVersionId: pack,
        devise: "TND",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "100.000", credit: "0", tax_code: null },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "100.000",
            tax_code: null,
          },
        ],
      });
      await office.book(db, e);
      return e;
    });
    const { rows } = await admin.query(`select status from socle.ecritures where id = $1`, [ecr]);
    assert.equal(rows[0]?.status, "booked");
  });
});
