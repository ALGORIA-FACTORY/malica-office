/**
 * Le lien d'une pièce vers celle dont elle est issue.
 *
 * Ajouté le 11 octobre 2026 avec le reçu de paiement : un reçu, un
 * justificatif, viennent d'UNE facture. Sans ce lien, le cabinet voit un
 * document flottant et personne ne peut dire ce qu'il atteste.
 *
 * Fichier à part, et non une seconde suite dans le fichier voisin : le
 * `after` de celui-ci ferme le pool, et les épreuves suivantes mouraient
 * annulées sans aucune raison lisible.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("la pièce dont une autre est issue", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `source-${Date.now()}`;
  let u: Utilisateur;
  let org = "";

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

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '1876543W/A/M/000', 'TN', 'TND') as id`,
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

  const deposer = (cle: string, extra: Record<string, unknown> = {}) =>
    rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "application/pdf",
      pageCount: 1,
      ...extra,
    }) as Promise<{ id: string }>;

  it("un reçu sait de quelle facture il vient, et l'application le lit", async () => {
    const facture = await deposer("facture");
    const recu = await deposer("recu", {
      documentKind: "recu_de_paiement",
      sourcePieceId: facture.id,
    });
    const dossier = (await rpc("capture", "dossier", recu.id)) as {
      piece: { sourcePieceId: string | null; documentKind: string | null };
    };
    assert.equal(dossier.piece.sourcePieceId, facture.id);
    assert.equal(dossier.piece.documentKind, "recu_de_paiement");
  });

  it("une pièce sans parent est le cas courant, et n'est pas une anomalie", async () => {
    const seule = await deposer("seule");
    const dossier = (await rpc("capture", "dossier", seule.id)) as {
      piece: { sourcePieceId: string | null };
    };
    assert.equal(dossier.piece.sourcePieceId, null);
  });

  it("un parent d'un AUTRE dossier est refusé par la base", async () => {
    // Sinon le lien pointerait hors du dossier, et la RLS rendrait un reçu
    // orphelin sans dire pourquoi.
    await assert.rejects(
      () =>
        deposer("parent-etranger", {
          documentKind: "recu_de_paiement",
          sourcePieceId: "00000000-0000-0000-0000-000000000000",
        }),
      /piece source introuvable ou non autorisee/,
    );
  });
});
