/**
 * Le justificatif de paiement arrive parfois APRÈS le paiement.
 *
 * ================================================================= POURQUOI
 *
 * 10 octobre 2026 : « à l'exception d'espèces les autres on doit prendre une
 * photo et la rattacher à la facture, et qui doit être transmise au comptable
 * avec la photo. » Le 11, le référentiel dit quels moyens l'exigent et la
 * colonne `justificatif_piece_id` existe — et rien ne permettait d'y arriver.
 *
 * ================================== POURQUOI UNE TABLE, ET PAS UNE MISE À JOUR
 *
 * `capture.paiements` est en ajout seul (R7) : un déclencheur refuse toute
 * mise à jour. Le fait « payé par chèque, 613,493, le 9 » est inscrit et ne se
 * réécrit pas.
 *
 * Restaient deux mauvaises réponses :
 *
 *   — bloquer le paiement jusqu'à la photo. Un écran qui refuse d'avancer se
 *     contourne en cochant « espèces », et l'information est perdue au lieu
 *     d'être gagnée ;
 *   — inscrire un second paiement portant la photo. Il doublerait le montant,
 *     et la seule chose pire qu'une charge manquante est une charge comptée
 *     deux fois.
 *
 * D'où un rattachement qui est une ÉCRITURE NOUVELLE, dans sa propre table.
 * Le paiement ne bouge pas ; la preuve s'ajoute, datée, et c'est la dernière
 * qui vaut — reprendre une photo floue est le cas normal.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le justificatif d'un paiement", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `preuve-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let packId = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  async function piece(cle: string) {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    return p.id;
  }

  /** Un paiement par chèque, donc un moyen qui EXIGE une preuve. */
  async function paiementParCheque(pieceId: string, justificatifPieceId?: string) {
    await rpc("capture", "enregistrerPaiement", {
      pieceId,
      packId,
      moyenCode: "cheque",
      montantMineur: 613_493,
      devise: "TND",
      payeLe: "2026-10-09",
      ...(justificatifPieceId ? { justificatifPieceId } : {}),
    });
    const liste = (await rpc("capture", "paiementsDUnePiece", pieceId)) as Array<{
      id: string;
      justificatifPieceId: string | null;
    }>;
    return liste[liste.length - 1]!;
  }

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      ),
    );
    await fermerLePool();
  });

  it("la photo prise AVANT entre avec le paiement, en une écriture", async () => {
    // C'est le chemin normal : on tape « chèque », l'appareil s'ouvre, et le
    // paiement naît déjà prouvé.
    const facture = await piece("avant-facture");
    const talon = await piece("avant-talon");
    const p = await paiementParCheque(facture, talon);
    assert.equal(p.justificatifPieceId, talon);
  });

  it("la photo prise APRÈS se rattache, sans toucher au paiement", async () => {
    const facture = await piece("apres-facture");
    const p = await paiementParCheque(facture);
    assert.equal(p.justificatifPieceId, null, "le paiement s'inscrit sans preuve : rien ne bloque");

    const talon = await piece("apres-talon");
    await rpc("capture", "rattacherJustificatif", p.id, talon);

    const liste = (await rpc("capture", "paiementsDUnePiece", facture)) as Array<{
      id: string;
      montantMineur: number | null;
      justificatifPieceId: string | null;
    }>;
    assert.equal(liste.length, 1, "rattacher n'invente pas un second paiement");
    assert.equal(liste[0]!.justificatifPieceId, talon);
    assert.equal(liste[0]!.montantMineur, 613_493, "et le montant n'a pas doublé");
  });

  it("une photo floue se reprend : c'est la dernière qui vaut", async () => {
    const facture = await piece("reprise-facture");
    const p = await paiementParCheque(facture);
    const floue = await piece("reprise-floue");
    const nette = await piece("reprise-nette");

    await rpc("capture", "rattacherJustificatif", p.id, floue);
    await rpc("capture", "rattacherJustificatif", p.id, nette);

    const liste = (await rpc("capture", "paiementsDUnePiece", facture)) as Array<{
      justificatifPieceId: string | null;
    }>;
    assert.equal(liste[0]!.justificatifPieceId, nette);

    // R7 : les deux faits sont là, aucun n'est réécrit.
    const faits = await admin(async (pool) => {
      const { rows } = await pool.query<{ n: string }>(
        `select count(*) as n from capture.paiement_justificatifs where paiement_id = $1`,
        [p.id],
      );
      return Number(rows[0]!.n);
    });
    assert.equal(faits, 2, "l'historique garde la première photo, elle n'est pas écrasée");
  });

  it("et le paiement lui-même reste intouchable", async () => {
    // La garantie qui rend tout ce mécanisme nécessaire. Si elle tombait, la
    // table de rattachement n'aurait plus de raison d'être.
    const facture = await piece("intouchable");
    const p = await paiementParCheque(facture);
    await assert.rejects(
      () =>
        admin((pool) =>
          pool.query(`update capture.paiements set montant_mineur = 1 where id = $1`, [p.id]),
        ),
      /R7 : UPDATE interdit sur capture\.paiements/,
      "un paiement qui se réécrit est un fait comptable qu'on peut nier",
    );
  });

  it("rattacher une pièce d'un AUTRE dossier est refusé", async () => {
    // Sans ce refus, une preuve pourrait pointer hors du dossier, et la RLS
    // du cabinet rendrait un justificatif introuvable sans dire pourquoi.
    const facture = await piece("autre-dossier");
    const p = await paiementParCheque(facture);
    await assert.rejects(
      () => rpc("capture", "rattacherJustificatif", p.id, "00000000-0000-0000-0000-000000000000"),
      /introuvable|non autorisee/,
    );
  });
});
