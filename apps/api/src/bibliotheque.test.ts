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
      values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'à comptabiliser','[{"motif":"Contrôle de la fixture"}]')`,
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

  it("range au mois de la date du document, sinon de la réception dans le fuseau de la personne", async () => {
    // Une facture datée de mars 2001, reçue aujourd'hui : elle appartient à mars 2001.
    const datee = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces
        (tenant_id,source,vis,storage_path,idempotency_key,created_by,document_kind,document_kind_statut)
        values ($1,'pdf','partage',$2,$2,$3,'facture_achat','confirme') returning id`,
        [client, `${marque}-datee`, expert.id],
      );
      return rows[0]!.id;
    });
    await admin.query(
      `insert into capture.extractions (tenant_id,piece_id,contract,payload)
      values ($1,$2,'extract.v1',$3::jsonb)`,
      [client, datee, JSON.stringify({ document_date: "2001-03-15" })],
    );
    const mars = await sousIdentite(expert.id, (db) => documents(db, cabinet, client, "2001-03"));
    assert.deepEqual(
      mars.map((d) => d.id),
      [datee],
    );
    assert.equal(mars[0]!.dateDeClassement, "2001-03-15");

    // Reçue le 31 janvier à 12 h UTC, sans date lue : à Kiritimati (UTC+14),
    // c'est déjà le 1er février. Le mois suit le fuseau de la personne.
    const { rows: tardive } = await admin.query<{ id: string }>(
      `insert into capture.pieces
      (tenant_id,source,vis,storage_path,idempotency_key,created_by,document_kind,document_kind_statut,created_at)
      values ($1,'pdf','partage',$2,$2,$3,'facture_achat','confirme','2002-01-31 12:00:00+00') returning id`,
      [client, `${marque}-tardive`, expert.id],
    );
    // Aucune route ne règle le fuseau ; un client ne réécrit plus une
    // préférence en direct (lot 6, verrous en base) : l'opérateur la pose.
    await admin.query(
      `insert into notif.preferences (user_id, fuseau) values ($1, 'Pacific/Kiritimati')
       on conflict (user_id) do update set fuseau = excluded.fuseau`,
      [expert.id],
    );
    const fevrier = await sousIdentite(expert.id, (db) =>
      documents(db, cabinet, client, "2002-02"),
    );
    assert.deepEqual(
      fevrier.map((d) => d.id),
      [tardive[0]!.id],
    );
    assert.equal(fevrier[0]!.dateDeClassement, "2002-02-01");
    assert.equal(
      (await sousIdentite(expert.id, (db) => documents(db, cabinet, client, "2002-01"))).length,
      0,
    );
  });

  it("une personne sans préférence reçoit le défaut livré, inscrit chez elle", async () => {
    const neuf = await creerCompte(`neuf-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(neuf);
    // Pas de mandat : la lecture est refusée, mais le fuseau n'est jamais deviné en silence.
    await assert.rejects(sousIdentite(neuf.id, (db) => documents(db, cabinet, client, null)));
    const avant = await admin.query(`select 1 from notif.preferences where user_id = $1`, [
      neuf.id,
    ]);
    assert.equal(avant.rowCount, 0, "le refus de mandat passe avant toute écriture");
    await admin.query(`delete from notif.preferences where user_id = $1`, [expert.id]);
    await sousIdentite(expert.id, (db) => documents(db, cabinet, client, null));
    const { rows } = await admin.query<{ fuseau: string; defaut: string }>(
      `select p.fuseau, (select column_default from information_schema.columns
                          where table_schema = 'notif' and table_name = 'preferences'
                            and column_name = 'fuseau') as defaut
         from notif.preferences p where p.user_id = $1`,
      [expert.id],
    );
    assert.equal(rows.length, 1, "le défaut livré devient une préférence visible");
    assert.ok(rows[0]!.defaut.includes(rows[0]!.fuseau));
  });

  it("restitue l'empreinte scellée à la réception et le montant au chemin commun des paramètres", async () => {
    const empreinte = "a".repeat(64);
    await admin.query(`update capture.pieces set sha256 = $2 where id = $1`, [facture, empreinte]);
    // Une analyse à jour de la dernière lecture : sans elle, aucun montant n'est restitué.
    const { rows: packs } = await admin.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN' order by effective_from desc limit 1`,
    );
    await admin.query(
      `insert into capture.analyses
      (tenant_id,piece_id,extraction_id,pack_version_id,normalisation,controles,verdict,motifs)
      select $1, $2, x.id, $3, $4::jsonb,
             '[{"code":"arithmetique","statut":"conforme","motif":"Montant de la fixture"}]'::jsonb,
             'à comptabiliser', '[{"motif":"Montant de la fixture"}]'::jsonb
        from capture.extractions x where x.piece_id = $2 order by x.created_at desc, x.id desc limit 1`,
      [
        client,
        facture,
        packs[0]!.id,
        JSON.stringify({ etat: "tranche", montants: { ttc: 12345 } }),
      ],
    );
    const lignes = await sousIdentite(expert.id, (db) => documents(db, cabinet, client, null));
    const f = lignes.find((d) => d.id === facture);
    assert.equal(f?.empreinte, empreinte);
    assert.equal(lignes.find((d) => d.id === vente)?.empreinte, null);
    // 12345 unités mineures, trois décimales au pack tunisien.
    assert.equal(f?.montant, "12.345");
    const dossier = await sousIdentite(expert.id, (db) =>
      documentsLies(db, cabinet, client, [facture]),
    );
    assert.equal(dossier.documents.find((d) => d.id === facture)?.empreinte, empreinte);
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
