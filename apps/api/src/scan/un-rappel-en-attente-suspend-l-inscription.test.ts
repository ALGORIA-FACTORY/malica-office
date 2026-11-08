/**
 * Un rappel en attente suspend l'inscription ; la réponse du cabinet porte
 * sa note jusqu'à la PME.
 *
 * ================================================================= POURQUOI
 *
 * Audit du 25 octobre 2026 :
 *
 * 1. La PME demande le rappel d'une pièce transmise, puis répond « Oui » au
 *    montant : la pièce se comptabilise. Le cabinet clique « Accorder », la
 *    base refuse (« une piece comptabilisee reste dans la societe »), et la
 *    demande reste suspendue à un accord devenu impossible.
 *
 * 2. Le refus du rappel n'arrivait pas à la PME : la notification ne portait
 *    ni la note du cabinet, que la base exige pourtant.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { lecture as lectureDEssai } from "./lecture-d-essai.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);
const MF_DOSSIER = matriculeDEssai("A", "M");

describe("un rappel en attente suspend l'inscription", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rappel-inscription-${Date.now()}`;
  let u: Utilisateur;
  let expert: Utilisateur;
  let org = "";
  let cabinet = "";
  let packId = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));
  const rpcCab = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(expert.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** Une facture lue, jugée comptabilisable, et transmise au cabinet. */
  async function pieceTransmise(cle: string) {
    const l = lectureDEssai({ clientMf: MF_DOSSIER, numero: `R-${cle}` });
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
    // Le type s'établit avant d'inscrire (le verrou R2) : le cabinet engagé
    // l'établit, la PME ne pose plus le sens (lot S5).
    await sousIdentite(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [p.id]),
    );
    await rpc("capture", "analyser", p.id);
    return p.id;
  }

  const etatDe = (id: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{ vis: string; status: string }>(
        `select vis, status from capture.pieces where id = $1`,
        [id],
      );
      return rows[0]!;
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'PME D''ESSAI SARL', 'autonome',
                                           '${MF_DOSSIER}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    const e = await creerCompte(`${marque}-cab@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(e);
    expert = e;
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', 'CABINET D''ESSAI', 'autonome',
                                           '${matriculeDEssai("B", "C")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    await admin(async (p) => {
      await p.query(
        `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
         values ($1, $2, 'actif', current_date - 1)`,
        [cabinet, org],
      );
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      packId = rows[0]!.id;
    });
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
        [[org, cabinet]],
      ),
    );
    await fermerLePool();
  });

  // Le cabinet est engagé : c'est lui qui propose et inscrit (lot S5 — la PME
  // n'inscrit plus rien d'un dossier confié, quel que soit son mode).

  it("la proposition est refusée tant que le rappel attend, et le dit", async () => {
    const id = await pieceTransmise("oui-sous-rappel");
    await rpc("collab", "demanderSurPiece", id, "rappel");

    await assert.rejects(
      () => rpcCab("office", "proposerDepuisPiece", id),
      /refus\.piece\.rappelEnAttente/,
    );
    assert.equal((await etatDe(id)).status, "lue", "rien n'a été proposé ni inscrit");

    // Le cabinet peut donc toujours accorder : la pièce revient à la société.
    await rpcCab("collab", "repondreSurPiece", id, "rappel", true, null);
    assert.equal((await etatDe(id)).vis, "entite");

    // La demande tranchée, la pièce renvoyée : l'inscription redevient possible.
    await rpc("collab", "setPieceVis", id, "partage");
    const ecriture = (await rpcCab("office", "proposerDepuisPiece", id)) as string;
    await rpcCab("office", "book", ecriture);
    assert.equal((await etatDe(id)).status, "supervisee");
  });

  it("une écriture proposée AVANT la demande ne s'inscrit pas pendant qu'elle attend", async () => {
    const id = await pieceTransmise("proposee-puis-rappel");
    const ecriture = (await rpcCab("office", "proposerDepuisPiece", id)) as string;
    await rpc("collab", "demanderSurPiece", id, "rappel");

    await assert.rejects(
      () => rpcCab("office", "book", ecriture),
      /refus\.piece\.rappelEnAttente/,
      "le cabinet tranche d'abord la demande",
    );
    // La PME, elle, n'inscrit jamais l'écriture d'un dossier confié.
    await assert.rejects(
      () => rpc("office", "book", ecriture),
      /refus\.(piece\.rappelEnAttente|inscription\.reservee_au_cabinet|ecriture\.non_inscriptible)$/,
    );

    // Refusé, le rappel ne bloque plus rien.
    await rpcCab("collab", "repondreSurPiece", id, "rappel", false, "Déjà en cours de saisie.");
    await rpcCab("office", "book", ecriture);
    assert.equal((await etatDe(id)).status, "supervisee");
  });

  it("la notification du refus porte le verdict ET la note du cabinet", async () => {
    const id = await pieceTransmise("refus-note");
    await rpc("collab", "demanderSurPiece", id, "rappel");
    await rpcCab("collab", "repondreSurPiece", id, "rappel", false, "Déjà déclarée en TVA.");

    const notifs = (await rpc("collab", "notifications", [org])) as Array<{
      kind: string;
      payload: Record<string, unknown>;
    }>;
    const tranchee = notifs.find(
      (n) => n.kind === "piece.demande_tranchee" && n.payload["piece_id"] === id,
    );
    assert.ok(tranchee, "la PME est notifiée");
    assert.equal(tranchee.payload["objet"], "rappel");
    assert.equal(tranchee.payload["accorde"], false);
    assert.equal(tranchee.payload["note"], "Déjà déclarée en TVA.");
  });
});
