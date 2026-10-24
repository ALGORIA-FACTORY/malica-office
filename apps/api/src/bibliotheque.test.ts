import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { creerCompte, type Utilisateur } from "./auth.ts";
import { documents, documentsLies, controlesPiece } from "./bibliotheque.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);

describe("bibliothèque comptable sous les rôles réels", { skip: !CONFIGUREE }, () => {
  const marque = `bibliotheque-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let expert: Utilisateur;
  let dirigeant: Utilisateur;
  let intrus: Utilisateur;
  let client = "";
  let cabinet = "";
  let facture = "";
  let preuve = "";
  let privee = "";
  let vente = "";

  before(async () => {
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const i = await creerCompte(`intrus-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(e && i);
    expert = e;
    dirigeant = e;
    intrus = i;
    const mf = matriculeDEssai();
    const creer = (u: Utilisateur, kind: string, nom: string, legal: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1,$2,'autonome',$3,'TN','TND') as id`,
          [kind, nom, legal],
        );
        return rows[0]!.id;
      });
    client = await creer(dirigeant, "pme", marque, mf);
    cabinet = await creer(expert, "cabinet", `Comptabilité ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [mandat] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, client));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, mandat!.id, true));
    // Le cas trompeur : l'expert est aussi membre de la société et peut lire
    // des pièces privées. La bibliothèque du cabinet ne doit pas les sortir.
    const ajouter = (vis: string, type: string, parent: string | null = null) =>
      sousIdentite(expert.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into capture.pieces
        (tenant_id,source,vis,storage_path,idempotency_key,created_by,document_kind,document_kind_statut,source_piece_id)
        values ($1,'pdf',$2,$3,$3,$4,$5,'confirme',$6) returning id`,
          [client, vis, `${marque}-${Math.random()}`, expert.id, type, parent],
        );
        return rows[0]!.id;
      });
    facture = await ajouter("partage", "facture_achat");
    preuve = await ajouter("partage", "justificatif_paiement", facture);
    privee = await ajouter("personnel", "justificatif_paiement", facture);
    vente = await ajouter("partage", "facture_vente");
    await admin.query(
      `insert into capture.extractions (tenant_id,piece_id,contract,payload)
      values ($1,$2,'extract.v1',$3::jsonb)`,
      [client, vente, JSON.stringify({ issuer: marque, references: { invoice_no: "V-001" } })],
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at=now(), archived_reason='fixture de test automatisé'
      where id=any($1::uuid[])`,
        [[client, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("ne liste que les pièces transmises, même pour un compte membre des deux espaces", async () => {
    const lignes = await sousIdentite(expert.id, (db) => documents(db, cabinet, client, null));
    assert.deepEqual(new Set(lignes.map((d) => d.id)), new Set([facture, preuve, vente]));
    assert.equal(
      lignes.find((d) => d.id === vente)?.tiers,
      null,
      "ne pas inventer un client avec l'émetteur",
    );
  });

  it("ferme les liens du dossier et exclut le justificatif privé", async () => {
    const dossier = await sousIdentite(expert.id, (db) =>
      documentsLies(db, cabinet, client, [facture, facture]),
    );
    assert.deepEqual(new Set(dossier.documents.map((d) => d.id)), new Set([facture, preuve]));
    assert.equal(dossier.documents.length, 2);
    await assert.rejects(
      sousIdentite(expert.id, (db) => documentsLies(db, cabinet, client, [privee])),
    );
  });

  it("refuse un utilisateur sans mandat et un identifiant étranger dans la sélection", async () => {
    await assert.rejects(sousIdentite(intrus.id, (db) => documents(db, cabinet, client, null)));
    await assert.rejects(
      sousIdentite(expert.id, (db) => documentsLies(db, cabinet, client, [facture, cabinet])),
    );
  });

  it("ne présente pas de contrôle fiscal lorsqu'aucune analyse n'existe", async () => {
    assert.equal(await sousIdentite(expert.id, (db) => controlesPiece(db, cabinet, facture)), null);
    await assert.rejects(sousIdentite(expert.id, (db) => controlesPiece(db, cabinet, privee)));
  });

  it("filtre sur le mois de réception et refuse une période invalide", async () => {
    assert.equal(
      (await sousIdentite(expert.id, (db) => documents(db, cabinet, client, "2001-01"))).length,
      0,
    );
    await assert.rejects(
      sousIdentite(expert.id, (db) => documents(db, cabinet, client, "2026-13")),
    );
  });

  it("restitue les contrôles réels et signale une analyse devenue ancienne", async () => {
    const { rows: packs } = await admin.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN' order by effective_from desc limit 1`,
    );
    const { rows: extraits } = await admin.query<{ id: string }>(
      `insert into capture.extractions (tenant_id,piece_id,contract,payload)
       values ($1,$2,'extract.v1','{}') returning id`,
      [client, facture],
    );
    await admin.query(
      `insert into capture.analyses
      (tenant_id,piece_id,extraction_id,pack_version_id,normalisation,controles,verdict,motifs)
      values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'à comptabiliser','[]')`,
      [
        client,
        facture,
        extraits[0]!.id,
        packs[0]!.id,
        JSON.stringify({ etat: "tranche", montants: { ttc: 12345 } }),
        JSON.stringify([
          { code: "arithmetique", statut: "conforme", motif: "Contrôle de la fixture" },
        ]),
      ],
    );
    const controle = await sousIdentite(expert.id, (db) => controlesPiece(db, cabinet, facture));
    assert.equal(controle?.aJour, true);
    assert.equal(controle?.controles[0]?.motif, "Contrôle de la fixture");
    await admin.query(
      `insert into capture.extractions (tenant_id,piece_id,contract,payload)
      values ($1,$2,'extract.v1','{}')`,
      [client, facture],
    );
    assert.equal(
      (await sousIdentite(expert.id, (db) => controlesPiece(db, cabinet, facture)))?.aJour,
      false,
    );
  });

  it("la révocation retire l'accès à la bibliothèque et à la restitution", async () => {
    await sousIdentite(dirigeant.id, (db) =>
      identite.revoquerMandat(db, client, "Fin de la recette de bibliothèque"),
    );
    await assert.rejects(sousIdentite(expert.id, (db) => documents(db, cabinet, client, null)));
    await assert.rejects(
      sousIdentite(expert.id, (db) => documentsLies(db, cabinet, client, [facture])),
    );
  });
});
