/**
 * Sans mandat actif, une pièce transmise est au client.
 *
 * L'accord du cabinet protège une relation de travail : le comptable a engagé sa
 * comptabilité sur la pièce. Quand AUCUN mandat n'est actif sur le dossier,
 * cette relation n'existe plus, et exiger l'accord de l'ancien cabinet ferait
 * dépendre le client de quelqu'un qu'il a quitté. La condition est l'absence de
 * mandat actif sur le DOSSIER, pas celui d'un cabinet donné : un dossier passé de
 * A à B exige l'accord de B, et A ne peut plus rien.
 *
 * Une pièce comptabilisée reste protégée dans tous les cas : une écriture
 * s'appuie dessus.
 *
 * Chaque cas a son dossier. Les dossiers s'archivent à la fin, ils ne se
 * suppriment pas (R7).
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

describe("sans mandat actif, la pièce est au client", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `sansmandat-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"], max: 1 });
  let dirigeant: Utilisateur;
  let expertA: Utilisateur;
  let expertB: Utilisateur;
  let cabinetA = "";
  let cabinetB = "";
  const dossiers: string[] = [];
  let n = 0;

  const rpc = (qui: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(qui.id, (db) => executerRpc(db, { depot, methode, args }));

  const code = (c: string) => (e: { code?: string }) => e.code === c;

  async function dossier(): Promise<string> {
    n += 1;
    const id = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`DOSSIER ${n} ${marque}`],
      );
      return rows[0]!.id;
    });
    dossiers.push(id);
    return id;
  }

  async function mandat(
    cabinet: string,
    pme: string,
    statut: string,
    fin: string | null = null,
  ): Promise<void> {
    await admin.query(
      `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on, ends_on)
       values ($1, $2, $3, current_date - 30, $4::date)`,
      [cabinet, pme, statut, fin],
    );
  }

  /** Une pièce transmise au cabinet (ou à personne, si le dossier n'a pas de mandat). */
  async function transmise(pme: string, cle: string): Promise<string> {
    const p = (await rpc(dirigeant, "capture", "enregistrer", {
      tenantId: pme,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    await rpc(dirigeant, "collab", "setPieceVis", p.id, "partage");
    return p.id;
  }

  const visDe = async (id: string) =>
    (await admin.query<{ vis: string }>("select vis from capture.pieces where id = $1", [id]))
      .rows[0]?.vis ?? null;

  before(async () => {
    const [d, a, b] = await Promise.all(
      ["dir", "a", "b"].map((x) =>
        creerCompte(`${marque}-${x}@essai.local`, "MotDePasseTresLong2026!"),
      ),
    );
    assert.ok(d && a && b);
    dirigeant = d;
    expertA = a;
    expertB = b;
    const cabinet = (qui: Utilisateur, nom: string, mf: string) =>
      sousIdentite(qui.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('cabinet', $1, 'autonome', $2, 'TN', 'TND') as id`,
          [`${nom} ${marque}`, mf],
        );
        return rows[0]!.id;
      });
    cabinetA = await cabinet(expertA, "CABINET A", matriculeDEssai("B", "C"));
    cabinetB = await cabinet(expertB, "CABINET B", matriculeDEssai("B", "C"));
  });

  after(async () => {
    await admin.query(
      `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = any($1::uuid[])`,
      [[...dossiers, cabinetA, cabinetB]],
    );
    await admin.end();
    await fermerLePool();
  });

  for (const [libelle, statut, fin] of [
    ["terminé", "termine", null],
    ["suspendu", "suspendu", null],
    ["seulement proposé", "propose", null],
    ["actif mais échu hier", "actif", "yesterday"],
  ] as const) {
    it(`mandat ${libelle}, aucun autre : le dirigeant rappelle sa pièce sans accord`, async () => {
      const pme = await dossier();
      await mandat(
        cabinetA,
        pme,
        statut,
        fin ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) : null,
      );
      const id = await transmise(pme, `rappel-${statut}-${fin ?? "x"}`);
      assert.equal(await rpc(dirigeant, "collab", "setPieceVis", id, "personnel"), true);
      assert.equal(await visDe(id), "personnel");
    });

    it(`mandat ${libelle}, aucun autre : le dirigeant supprime sa pièce sans accord`, async () => {
      const pme = await dossier();
      await mandat(
        cabinetA,
        pme,
        statut,
        fin ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) : null,
      );
      const id = await transmise(pme, `suppr-${statut}-${fin ?? "x"}`);
      assert.equal(await rpc(dirigeant, "capture", "supprimer", id, false), true);
      assert.equal(await visDe(id), null);
    });
  }

  it("aucun mandat n'a jamais existé : la pièce transmise à personne se reprend et se supprime", async () => {
    const pme = await dossier();
    const a = await transmise(pme, "jamais-a");
    const b = await transmise(pme, "jamais-b");
    assert.equal(await rpc(dirigeant, "collab", "setPieceVis", a, "personnel"), true);
    assert.equal(await rpc(dirigeant, "capture", "supprimer", b, false), true);
  });

  it("de A (terminé) à B (actif) : l'accord est exigé, B le donne, A ne peut plus rien", async () => {
    const pme = await dossier();
    await mandat(cabinetA, pme, "termine");
    await mandat(cabinetB, pme, "actif");
    const id = await transmise(pme, "changement");

    // Le dirigeant ne reprend ni ne supprime seul : un mandat est actif.
    await assert.rejects(rpc(dirigeant, "collab", "setPieceVis", id, "personnel"), code("23514"));
    await assert.rejects(rpc(dirigeant, "capture", "supprimer", id, false), code("23514"));

    await rpc(dirigeant, "collab", "demanderSurPiece", id, "suppression");
    // L'ancien cabinet ne voit plus rien et ne tranche pas.
    await assert.rejects(
      rpc(expertA, "collab", "repondreSurPiece", id, "suppression", true, null),
      code("42501"),
    );
    assert.equal(await visDe(id), "partage");

    await rpc(expertB, "collab", "repondreSurPiece", id, "suppression", true, null);
    assert.equal(await visDe(id), null);
  });

  it("mandat actif : le dirigeant ne se donne pas l'accord, comme avant", async () => {
    const pme = await dossier();
    await mandat(cabinetA, pme, "actif");
    const id = await transmise(pme, "actif");
    await assert.rejects(rpc(dirigeant, "capture", "supprimer", id, false), code("23514"));
    await rpc(dirigeant, "collab", "demanderSurPiece", id, "rappel");
    await assert.rejects(
      rpc(dirigeant, "collab", "repondreSurPiece", id, "rappel", true, null),
      code("42501"),
    );
    await rpc(expertA, "collab", "repondreSurPiece", id, "rappel", true, null);
    assert.equal(await visDe(id), "personnel");
  });

  for (const statut of ["comptabilisee", "supervisee"]) {
    it(`une pièce ${statut} reste protégée sans mandat actif : ni rappel, ni suppression`, async () => {
      const pme = await dossier();
      await mandat(cabinetA, pme, "termine");
      const id = await transmise(pme, `compta-${statut}`);
      await admin.query("update capture.pieces set status = $2 where id = $1", [id, statut]);
      await assert.rejects(rpc(dirigeant, "collab", "setPieceVis", id, "personnel"), code("23514"));
      await assert.rejects(rpc(dirigeant, "capture", "supprimer", id, false), code("23514"));
      assert.equal(await visDe(id), "partage");
    });
  }
});
