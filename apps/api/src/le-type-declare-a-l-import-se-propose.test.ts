/**
 * Le type déclaré à l'import entre dans la proposition d'écriture (recette du 14 novembre 2026, G1).
 *
 * Constat : une facture d'achat déclarée « Facture d'achat » à l'import, et dont la lecture
 * n'a pas relevé le type, répondait `aCompleter: ["type"]` : `propositionDePiece` ne lisait
 * que le sens CONFIRMÉ (`statut = 'confirme'`), alors que la déclaration à l'import pose le
 * type avec le statut « a_confirmer ». Décision : la déclaration est le type de la pièce ;
 * une pièce qui n'en a ni déclaré ni lu reste « à compléter », et la raison le dit.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-type-declare-a-l-import-se-propose.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le type déclaré à l'import entre dans la proposition", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `type-declare-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mf = matriculeDEssai("A", "M");
  let dirigeant: Utilisateur;
  let pme = "";
  let packId = "";
  let n = 0;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const pmeFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(dirigeant.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  /**
   * Une facture enregistrée avec son type déclaré (ou sans), puis lue SANS type : la lecture
   * n'a pas su dire le sens, c'est le cas qui bloquait.
   */
  const lueSansType = async (declare: string | null) => {
    n += 1;
    const l = lectureDEssai({ clientMf: mf, numero: `TYPE-${n}` });
    const { document_kind: _lu, ...sansType } = l.extract as Record<string, unknown>;
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
              extract: sansType,
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: null,
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
    return p.id;
  };

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant);
    pme = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME TYPE ${marque}`, mf],
      );
      return rows[0]!.id;
    });
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
          where id = $1::uuid and archived_at is null`,
        [pme],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("une facture d'achat déclarée à l'import est proposée, même si la lecture n'a pas lu son type", async () => {
    const id = await lueSansType("facture_achat");
    const p = (await pmeFait("office.propositionDePiece", id)) as {
      aCompleter?: string[];
      raison?: string;
    };
    assert.ok(
      !(p.aCompleter ?? []).includes("type"),
      `le type déclaré doit suffire : ${JSON.stringify(p)}`,
    );
  });

  it("une pièce sans type déclaré ni lu reste « à compléter », et la raison le dit", async () => {
    const id = await lueSansType(null);
    const p = (await pmeFait("office.propositionDePiece", id)) as {
      ok: boolean;
      aCompleter?: string[];
      raison?: string;
    };
    assert.equal(p.ok, false);
    assert.deepEqual(p.aCompleter, ["type"]);
    assert.match(p.raison ?? "", /type/);
  });
});
