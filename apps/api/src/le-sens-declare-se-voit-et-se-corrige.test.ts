/**
 * Le sens d'une pièce dit d'où il vient, et la comptabilité peut le corriger (recette du 14 novembre
 * 2026, décision du dirigeant).
 *
 *   - `declare` : la PME a déclaré le sens à l'import, ni la lecture ni une personne ne l'ont confirmé ;
 *   - `lu`      : la lecture le trouve sur la pièce, et il est la déclaration ;
 *   - `confirme`: le cabinet (ou la PME) l'a tranché : la proposition le dit, et le cabinet le change.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-sens-declare-se-voit-et-se-corrige.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le sens déclaré se voit et se corrige", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `sens-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mf = matriculeDEssai("B", "M");
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let cabinet = "";
  let pme = "";
  let packId = "";
  let n = 0;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const pmeFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(dirigeant.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const cabinetFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(expert.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  /** Une facture enregistrée avec un type déclaré (ou non), lue avec ou sans son sens. */
  const piece = async (declare: string | null, lu: "sans" | "meme" | "autre") => {
    n += 1;
    const l = lectureDEssai({ clientMf: mf, numero: `SENS-${n}` });
    const extrait: Record<string, unknown> = { ...l.extract };
    if (lu === "sans") delete extrait["document_kind"];
    if (lu === "autre") extrait["document_kind"] = "facture_vente";
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
      documentKind: declare,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: p.id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract: extrait,
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: lu === "sans" ? null : (extrait["document_kind"] as string),
              documentDate: l.extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", p.id);
    // Le dossier est en mandat : le cabinet doit voir la pièce.
    await pmeFait("collab.setPieceVis", p.id, "partage");
    return p.id;
  };

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant && expert);
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'mandate', null, 'TN', 'TND') as id`,
        [`CABINET SENS ${marque}`],
      );
      return rows[0]!.id;
    });
    pme = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'mandate', $2, 'TN', 'TND') as id`,
        [`PME SENS ${marque}`, mf],
      );
      return rows[0]!.id;
    });
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[cabinet, pme].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("un sens déclaré, que rien ne lit ni ne confirme, se dit « déclaré par la PME »", async () => {
    const id = await piece("facture_achat", "sans");
    const p = (await pmeFait("office.propositionDePiece", id)) as { sensOrigine: string | null };
    assert.equal(p.sensOrigine, "declare");
  });

  it("un sens lu, qui redit la déclaration, se dit « lu »", async () => {
    const id = await piece("facture_achat", "meme");
    const p = (await pmeFait("office.propositionDePiece", id)) as { sensOrigine: string | null };
    assert.equal(p.sensOrigine, "lu");
  });

  it("le cabinet corrige le sens déclaré : la proposition le dit « confirmé », et le sens change", async () => {
    const id = await piece("facture_achat", "sans");
    assert.equal(
      ((await cabinetFait("office.propositionDePiece", id)) as { sensOrigine: string }).sensOrigine,
      "declare",
    );
    await cabinetFait("office.trancherLeSens", id, "facture_vente");
    const apres = (await cabinetFait("office.propositionDePiece", id)) as {
      sensOrigine: string | null;
    };
    assert.equal(apres.sensOrigine, "confirme");
    const { rows } = await admin.query<{ document_kind: string }>(
      `select document_kind from capture.pieces where id = $1::uuid`,
      [id],
    );
    assert.equal(rows[0]!.document_kind, "facture_vente", "le sens retenu est celui du cabinet");
  });
});
