/**
 * L'annulation d'un règlement inscrit revient à l'expert qui tient le dossier.
 *
 * Revue du 24 octobre 2026, décision de Wissem Barouni : quand une
 * comptabilité est mandatée, la PME qui annule un paiement ne touche pas au
 * grand livre qu'elle a confié. La contre-passation naît PROPOSÉE dans la file
 * de l'expert ; l'écriture d'origine reste vivante jusqu'à ce qu'il l'inscrive.
 * Une PME autonome, elle, inscrit seule (`le-moyen-de-paiement-produit-son-ecriture`).
 *
 *   node --experimental-strip-types --test src/scan/l-annulation-d-un-reglement-revient-a-l-expert.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { identite } from "../depots/identite.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("l'annulation d'un règlement revient à l'expert", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `annulation-expert-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}R/A/M/000`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let pack = "";
  let motif = "";

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));

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
    const { rows: packs } = await admin.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    pack = packs[0]!.id;
    const { rows: motifs } = await admin.query<{ id: string }>(
      `select id from ref.paiement_motifs_annulation where code = 'moyen_errone'`,
    );
    motif = motifs[0]!.id;
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

  /** Une facture d'achat partagée et lue : 100 DT TTC, sous le seuil de retenue. */
  async function factureLue(cle: string): Promise<string> {
    const piece = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}-${cle}.pdf`, `${marque}-${cle}`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    const { rows } = await admin.query<{ id: string }>(
      `insert into capture.extractions (tenant_id, piece_id, contract, payload)
       values ($1, $2, 'extract.v1', $3::jsonb) returning id`,
      [pme, piece, JSON.stringify({ issuer: "COMPTOIR DU CENTRE SUARL" })],
    );
    await admin.query(
      `insert into capture.analyses
         (tenant_id, piece_id, extraction_id, pack_version_id, normalisation, controles, verdict, motifs)
       values ($1, $2, $3, $4, $5::jsonb, '[{"controle":"essai","ok":true}]'::jsonb,
               'à comptabiliser', '[{"motif":"essai"}]'::jsonb)`,
      [
        pme,
        piece,
        rows[0]!.id,
        pack,
        JSON.stringify({ etat: "tranche", montants: { ttc: 100_000, tva: null } }),
      ],
    );
    return piece;
  }

  it("la PME annule : la contre-passation attend l'expert, puis il l'inscrit", async () => {
    const piece = await factureLue("annule");
    const paiement = (await rpc(dirigeant, "capture", "enregistrerPaiement", {
      pieceId: piece,
      packId: pack,
      moyenCode: "virement",
      montantMineur: 100_000,
      devise: "TND",
      payeLe: "2026-10-13",
      justificatifPieceId: null,
      reference: "VIR-MANDAT",
    })) as string;
    const original = (await rpc(expert, "office", "inscrireLeReglement", paiement)) as string;

    await rpc(dirigeant, "capture", "annulerPaiement", paiement, motif);

    const { rows: contre } = await admin.query<{ id: string; status: string }>(
      `select id, status from socle.ecritures where reverses_id = $1`,
      [original],
    );
    assert.equal(contre.length, 1, "une seule contre-passation");
    assert.equal(contre[0]!.status, "proposee", "la PME n'inscrit pas dans le dossier confié");
    const vivante = async () =>
      (await admin.query<{ v: boolean }>(`select app.ecriture_vivante($1) as v`, [original]))
        .rows[0]!.v;
    assert.equal(await vivante(), true, "l'original vit tant que l'expert n'a pas inscrit");

    await rpc(expert, "office", "book", contre[0]!.id);

    const { rows: apres } = await admin.query<{ status: string; booked_by: string }>(
      `select status, booked_by::text from socle.ecritures where id = $1`,
      [contre[0]!.id],
    );
    assert.equal(apres[0]!.status, "booked");
    assert.equal(apres[0]!.booked_by, expert.id, "c'est l'expert qui a inscrit");
    assert.equal(await vivante(), false, "l'original est éteint par la contre-passation");
  });
});
