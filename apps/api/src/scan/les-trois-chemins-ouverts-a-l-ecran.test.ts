/**
 * Les trois chemins que la base ouvrait et que rien n'atteignait.
 *
 *   - `collab.setPieceVis(id, 'entite')`        : la société est un lieu à part ;
 *   - `collab.demanderSurPiece(id, 'suppression')` : demander l'effacement d'une
 *     pièce transmise, à côté du rappel ;
 *   - `capture.supprimer(id, false)`            : le second argument, que l'écran
 *     passe et ne choisit jamais.
 *
 * Pour chacun : le chemin ouvert fonctionne, et celui qui ne l'est pas reste
 * fermé. Surtout le dernier : un `true` venu d'un appel d'écran effacerait une
 * pièce transmise sans l'accord du cabinet, et la base ne le sait pas refuser
 * (c'est `piece_repondre` qui est censée seul le poser) — c'est donc le dépôt qui
 * le refuse, avant toute écriture.
 *
 * Le dossier d'essai s'archive à la fin, il ne se supprime pas (R7).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("les trois chemins ouverts à l'écran", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `ecran-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"], max: 1 });
  let u: Utilisateur;
  let org = "";
  // Le cabinet sous mandat : seul lui tranche une demande sur une pièce transmise.
  let expert: Utilisateur;
  let cabinet = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const rpcCab = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(expert.id, (db) => executerRpc(db, { depot, methode, args }));

  async function piece(cle: string, vis: "personnel" | "entite" | "partage" = "personnel") {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    if (vis !== "personnel") await rpc("collab", "setPieceVis", p.id, vis);
    return p.id;
  }

  const existe = async (id: string) =>
    (await admin.query("select 1 from capture.pieces where id = $1", [id])).rows.length === 1;

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ECRAN SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    const e = await creerCompte(`${marque}-cab@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(e);
    expert = e;
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', 'AUDICORP', 'autonome',
                                           '${matriculeDEssai("B", "C")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    await admin.query(
      `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
       values ($1, $2, 'actif', current_date - 1)`,
      [cabinet, org],
    );
  });

  after(async () => {
    await admin.query(
      `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = any($1)`,
      [[org, cabinet]],
    );
    await admin.end();
    await fermerLePool();
  });

  it("setPieceVis atteint 'entite' : la pièce passe à la société", async () => {
    const id = await piece("entite");
    assert.equal(await rpc("collab", "setPieceVis", id, "entite"), true);
    const { rows } = await admin.query<{ vis: string; transmise_le: Date | null }>(
      "select vis, transmise_le from capture.pieces where id = $1",
      [id],
    );
    assert.equal(rows[0]!.vis, "entite");
    assert.equal(
      rows[0]!.transmise_le,
      null,
      "la société n'est pas le cabinet : rien n'est transmis",
    );
  });

  it("setPieceVis ne connaît toujours pas de lieu inventé", async () => {
    const id = await piece("inventee");
    await assert.rejects(rpc("collab", "setPieceVis", id, "cabinet"));
    const { rows } = await admin.query("select vis from capture.pieces where id = $1", [id]);
    assert.equal(rows[0]!.vis, "personnel");
  });

  it("demanderSurPiece accepte 'suppression' sur une pièce transmise, une seule fois", async () => {
    const id = await piece("transmise", "partage");
    assert.deepEqual(await rpc("collab", "demanderSurPiece", id, "suppression"), {
      dejaDemandee: false,
    });
    assert.deepEqual(await rpc("collab", "demanderSurPiece", id, "suppression"), {
      dejaDemandee: true,
    });
    const { rows } = await admin.query<{ objet: string; fait: string }>(
      "select objet, fait from collab.demandes_sur_piece where piece_id = $1",
      [id],
    );
    assert.deepEqual(rows, [{ objet: "suppression", fait: "demandee" }]);
    assert.ok(await existe(id), "demander n'efface rien : c'est le cabinet qui tranche");
  });

  it("demanderSurPiece reste fermé sur une pièce qui n'est pas transmise", async () => {
    const id = await piece("chez-soi");
    await assert.rejects(
      rpc("collab", "demanderSurPiece", id, "suppression"),
      (e: { code?: string }) => e.code === "23514",
    );
  });

  it("supprimer(id, false) efface une pièce qui n'est partie nulle part", async () => {
    const id = await piece("libre");
    assert.equal(await rpc("capture", "supprimer", id, false), true);
    assert.equal(await existe(id), false);
  });

  it("supprimer(id) sans second argument vaut false", async () => {
    const id = await piece("libre-sans-arg");
    assert.equal(await rpc("capture", "supprimer", id), true);
    assert.equal(await existe(id), false);
  });

  it("supprimer(id, false) sur une pièce transmise est refusé par la base", async () => {
    const id = await piece("partie", "partage");
    await assert.rejects(
      rpc("capture", "supprimer", id, false),
      (e: { code?: string }) => e.code === "23514",
    );
    assert.ok(await existe(id));
  });

  it("supprimer(id, true) ne passe jamais depuis un appel d'écran, même sur une pièce libre", async () => {
    const transmise = await piece("forcee", "partage");
    const libre = await piece("forcee-libre");
    for (const id of [transmise, libre]) {
      await assert.rejects(
        rpc("capture", "supprimer", id, true),
        (e: { code?: string; message?: string }) =>
          e.code === "42501" && e.message === "suppression.accord_reserve_au_cabinet",
      );
      assert.ok(await existe(id), "le dépôt refuse avant toute écriture");
    }
  });
  /*
   * L'ACCORD SE DÉRIVE DE LA DONNÉE. Le dépôt refuse `true`, mais la fonction de
   * la base est accordée à `authenticated` : un appel direct la rouvrait.
   * Ces épreuves passent donc par la base, sans le dépôt.
   */
  const direct = (sql: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => db.query(sql, args));

  it("la base refuse un accord de suppression qu'aucune donnée n'établit", async () => {
    const id = await piece("accord-forge", "partage");
    await assert.rejects(
      direct("select public.capture_piece_supprimer($1, true)", id),
      (e: { code?: string }) => e.code === "23514",
      "true sans aucune demande",
    );
    await rpc("collab", "demanderSurPiece", id, "suppression");
    await assert.rejects(
      direct("select public.capture_piece_supprimer($1, true)", id),
      (e: { code?: string }) => e.code === "23514",
      "true avec une demande seulement en cours",
    );
    await rpcCab("collab", "repondreSurPiece", id, "suppression", false, "Déjà déclarée.");
    await assert.rejects(
      direct("select public.capture_piece_supprimer($1, true)", id),
      (e: { code?: string }) => e.code === "23514",
      "true après un refus",
    );
    assert.ok(await existe(id));
  });

  it("l'accord inscrit par piece_repondre, lui, efface bien la pièce", async () => {
    const id = await piece("accord-vrai", "partage");
    await rpc("collab", "demanderSurPiece", id, "suppression");
    await rpcCab("collab", "repondreSurPiece", id, "suppression", true, null);
    assert.equal(await existe(id), false);
  });

  it("la base refuse aussi le retrait d'une pièce transmise forgé par un `true`", async () => {
    const id = await piece("rappel-forge", "partage");
    await assert.rejects(
      direct("select public.capture_piece_set_vis($1, 'personnel'::app.vis_t, true)", id),
      (e: { code?: string }) => e.code === "23514",
    );
    await rpc("collab", "demanderSurPiece", id, "rappel");
    await assert.rejects(
      direct("select public.capture_piece_set_vis($1, 'personnel'::app.vis_t, true)", id),
      (e: { code?: string }) => e.code === "23514",
      "une demande en cours n'est pas un accord",
    );
    const { rows } = await admin.query("select vis from capture.pieces where id = $1", [id]);
    assert.equal(rows[0]!.vis, "partage");
  });

  it("un accord de rappel ne vaut pas accord de suppression", async () => {
    const id = await piece("accord-croise", "partage");
    await rpc("collab", "demanderSurPiece", id, "rappel");
    await rpcCab("collab", "repondreSurPiece", id, "rappel", true, null);
    // La pièce est revenue chez le dirigeant ; on la retransmet, sans nouvelle demande.
    await rpc("collab", "setPieceVis", id, "partage");
    await assert.rejects(
      direct("select public.capture_piece_supprimer($1, true)", id),
      (e: { code?: string }) => e.code === "23514",
    );
    await assert.rejects(
      direct("select public.capture_piece_set_vis($1, 'personnel'::app.vis_t, true)", id),
      (e: { code?: string }) => e.code === "23514",
      "l'accord d'avant la retransmission est périmé",
    );
    assert.ok(await existe(id));
  });
});
