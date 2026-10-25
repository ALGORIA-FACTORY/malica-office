/**
 * Une pièce pas encore confirmée se rejuge aux règles du jour.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Recette du 25 octobre 2026 : des pièces scannées avant les corrections des
 * contrôles restaient bloquées sur le verdict de l'ancienne règle (« les
 * montants ne se recoupent pas ») alors que les règles d'aujourd'hui les
 * acceptent. Le jugement n'était refait que sur une lecture NOUVELLE.
 *
 * Décision de Wissem Barouni : « corrige les anciens avec les nouvelles
 * règles ». Ouvrir une pièce pas encore confirmée la rejuge ; un jugement ne
 * s'inscrit que s'il diffère du dernier (R7, aucune ligne réécrite) ; une
 * pièce confirmée garde le sien.
 *
 *   node --experimental-strip-types --test src/scan/une-ancienne-piece-se-rejuge-aux-regles-du-jour.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";

import { lecture } from "./lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

type Proposition = { ok: boolean; verdict?: string; raison?: string };

describe("une ancienne pièce se rejuge aux règles du jour", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rejuge-${Date.now()}`;
  const MF_DOSSIER = matriculeDEssai();
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let u: Utilisateur;
  let org = "";
  let packId = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));

  /** Une facture d'achat juste, lue et jugée aux règles du jour. */
  async function factureLue(cle: string): Promise<string> {
    const l = lecture({ clientMf: MF_DOSSIER, numero: `F-${cle}` });
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await rpc("capture", "persisterLecture", {
      pieceId: p.id,
      packId,
      tokens: l.tokens,
      contract: "extract.v1",
      extract: l.extract,
      citations: l.citations,
      flags: [],
      articles: [],
      documentKind: "facture_achat",
      documentDate: l.extract.document_date,
      mode: "pdf-text",
      confianceParChamp: { "totals.ttc": 0.95 },
    });
    await rpc("capture", "analyser", p.id);
    return p.id;
  }

  /** Le verdict d'une règle d'hier, posé après le jugement du jour sur la même lecture. */
  async function jugementDHier(pieceId: string): Promise<void> {
    await admin.query(
      `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                     normalisation, controles, verdict, motifs, created_at)
       select a.tenant_id, a.piece_id, a.extraction_id, a.pack_version_id, a.normalisation,
              '[{"code":"coherence_arithmetique","statut":"anomalie","motif":"règle d''hier"}]'::jsonb,
              'anomalie à signaler',
              '[{"code":"coherence_arithmetique","statut":"anomalie","motif":"règle d''hier"}]'::jsonb,
              a.created_at + interval '1 millisecond'
         from capture.analyses a where a.piece_id = $1
        order by a.created_at desc limit 1`,
      [pieceId],
    );
  }

  const jugements = async (pieceId: string) =>
    (
      await admin.query<{ n: number }>(
        `select count(*)::int as n from capture.analyses where piece_id = $1`,
        [pieceId],
      )
    ).rows[0]!.n;

  const dernierVerdict = async (pieceId: string) =>
    (
      await admin.query<{ verdict: string }>(
        `select verdict from capture.analyses where piece_id = $1
          order by created_at desc limit 1`,
        [pieceId],
      )
    ).rows[0]!.verdict;

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SARL', 'autonome',
                                           '${MF_DOSSIER}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    const { rows } = await admin.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    packId = rows[0]!.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("ouverte, une pièce lue quitte le verdict d'une règle d'hier", async () => {
    const piece = await factureLue("ancienne");
    const verdictDuJour = await dernierVerdict(piece);
    assert.notEqual(verdictDuJour, "anomalie à signaler", "la facture d'essai est juste");
    await jugementDHier(piece);
    assert.equal(await dernierVerdict(piece), "anomalie à signaler");
    const avant = await jugements(piece);

    const r = (await rpc("office", "propositionDePiece", piece, null)) as Proposition;

    assert.equal(await jugements(piece), avant + 1, "un jugement nouveau, aucun réécrit");
    assert.equal(await dernierVerdict(piece), verdictDuJour, "le verdict d'aujourd'hui revient");
    assert.equal(r.verdict, verdictDuJour, "l'écran reçoit le verdict du jour");
  });

  it("rouvrir une pièce dont rien n'a changé n'ajoute aucun jugement", async () => {
    const piece = await factureLue("stable");
    await rpc("office", "propositionDePiece", piece, null);
    const avant = await jugements(piece);
    await rpc("office", "propositionDePiece", piece, null);
    await rpc("office", "propositionDePiece", piece, null);
    assert.equal(await jugements(piece), avant);
  });

  it("une pièce confirmée garde son jugement", async () => {
    const piece = await factureLue("confirmee");
    await admin.query(`update capture.pieces set status = 'confirmee' where id = $1`, [piece]);
    await jugementDHier(piece);
    const avant = await jugements(piece);
    await rpc("office", "propositionDePiece", piece, null);
    assert.equal(await jugements(piece), avant, "rien ne se rejuge après la confirmation");
    assert.equal(await dernierVerdict(piece), "anomalie à signaler");
  });
});
