/**
 * Un document se rattache à une pièce après la lecture, et se détache
 * (24 octobre 2026, option A validée par Wissem).
 *
 * Contre la base, sous l'identité d'un vrai compte : un rattachement vaut dans
 * les deux sens, ne se double pas, se détache avec un motif et reste au
 * registre (R7) ; l'espace privé et un autre dossier sont refusés ; une pièce
 * non engagée qui a été rattachée reste effaçable.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/scan/un-document-se-rattache-a-une-piece.test.ts
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

describe("un document se rattache à une pièce", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rattache-${Date.now()}`;
  let dirigeant: Utilisateur;
  let etranger: Utilisateur;
  let pme = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const organisation = (u: Utilisateur, nom: string) =>
    sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [nom, matriculeDEssai()],
      );
      return rows[0]!.id;
    });

  const piece = (cle: string, vis: "entite" | "personnel" = "entite") =>
    sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key,
                                     created_by, document_kind, document_kind_statut)
         values ($1, 'pdf', $2::app.vis_t, $3, $4, $5, 'facture_achat', 'confirme') returning id`,
        [pme, vis, `essai/${marque}-${cle}.pdf`, `${marque}-${cle}`, dirigeant.id],
      );
      return rows[0]!.id;
    });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot: "capture", methode, args }));

  const liees = async (id: string) =>
    ((await rpc(dirigeant, "piecesRattachees", id)) as Array<{ id: string }>).map((p) => p.id);

  const faits = async (a: string, b: string) =>
    (
      await admin.query<{ fait: string }>(
        `select fait from capture.rattachements
          where (piece_id = $1 and piece_liee_id = $2) or (piece_id = $2 and piece_liee_id = $1)
          order by created_at, rang`,
        [a, b],
      )
    ).rows.map((r) => r.fait);

  before(async () => {
    const d = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`${marque}-autre@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    etranger = e;
    pme = await organisation(dirigeant, `PME ${marque}`);
    await organisation(etranger, `Autre ${marque}`);
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé'
          where name like $1`,
        [`%${marque}`],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("vaut dans les deux sens, et ne se double pas", async () => {
    const facture = await piece("facture");
    const bl = await piece("bl");
    assert.deepEqual(await rpc(dirigeant, "rattacher", facture, bl), { deja: false });
    assert.deepEqual(await liees(facture), [bl]);
    assert.deepEqual(await liees(bl), [facture]);
    // Dans l'autre sens, la paire est la même : rien de plus au registre.
    assert.deepEqual(await rpc(dirigeant, "rattacher", bl, facture), { deja: true });
    assert.deepEqual(await faits(facture, bl), ["rattache"]);
  });

  it("se détache avec un motif, et le registre garde les deux faits", async () => {
    const facture = await piece("facture-2");
    const avoir = await piece("avoir");
    await rpc(dirigeant, "rattacher", facture, avoir);
    await assert.rejects(rpc(dirigeant, "detacher", avoir, facture, "  "), /pourquoi/);
    await rpc(dirigeant, "detacher", avoir, facture, "Pas le bon fournisseur");
    assert.deepEqual(await liees(facture), []);
    assert.deepEqual(await faits(facture, avoir), ["rattache", "detache"]);
    // Détacher ce qui ne l'est plus est refusé ; rattacher de nouveau, permis.
    await assert.rejects(rpc(dirigeant, "detacher", facture, avoir, "encore"), /pas rattaché/);
    await rpc(dirigeant, "rattacher", avoir, facture);
    assert.deepEqual(await liees(facture), [avoir]);
  });

  it("refuse l'espace privé, une pièce elle-même, et un autre dossier", async () => {
    const facture = await piece("facture-3");
    const privee = await piece("privee", "personnel");
    await assert.rejects(rpc(dirigeant, "rattacher", facture, privee), /espace privé/);
    await assert.rejects(rpc(dirigeant, "rattacher", facture, facture), /elle-même/);
    const autre = await piece("autre");
    await assert.rejects(rpc(etranger, "rattacher", facture, autre), /non autorisee/);
  });

  it("ne se réécrit pas : ni modification ni suppression directes", async () => {
    const a = await piece("r7-a");
    const b = await piece("r7-b");
    await rpc(dirigeant, "rattacher", a, b);
    await sousIdentite(dirigeant.id, async (db) => {
      await assert.rejects(
        db.query("update capture.rattachements set fait = 'detache' where piece_id = $1", [a]),
        /permission denied|R7/,
      );
    });
    await sousIdentite(dirigeant.id, async (db) => {
      await assert.rejects(
        db.query("delete from capture.rattachements where piece_id = $1", [a]),
        /permission denied|R7/,
      );
    });
  });

  it("une pièce non engagée qui a été rattachée reste effaçable, des deux côtés", async () => {
    const facture = await piece("efface-facture");
    const brouillon = await piece("efface-brouillon");
    const autre = await piece("efface-autre");
    await rpc(dirigeant, "rattacher", facture, brouillon);
    await rpc(dirigeant, "rattacher", autre, facture);
    // `brouillon` est au bout « lié » d'une paire, `autre` au bout « pièce ».
    assert.equal(await rpc(dirigeant, "supprimer", brouillon), true);
    assert.equal(await rpc(dirigeant, "supprimer", autre), true);
    assert.deepEqual(await liees(facture), []);
  });
});
