/**
 * Le nom de l'émetteur se corrige, comme le type et la date.
 *
 * Recette du 2 novembre 2026, facture MyTek : la lecture a pris le logo
 * stylisé, lu « MITEK », pour le nom de l'émetteur. Décision du dirigeant,
 * 3 novembre : « on doit accepter la correction et on met le petit crayon
 * devant le nom ».
 *
 *   - la correction est une précision (R7) : la lecture reste telle quelle ;
 *   - la fiche, la liste et le jugement portent le nom corrigé ;
 *   - redire le même nom n'écrit rien ;
 *   - un nom vide, un nom trop long, une pièce engagée sont refusés ;
 *   - le journal garde ce qui était retenu avant ;
 *   - dans un dossier dont le cabinet tient les livres, la PME corrige le nom
 *     (ce n'est pas le sens).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-nom-de-l-emetteur-se-corrige.test.ts
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

const LU = "MITEK";
const IMPRIME = "MyTek";

describe("le nom de l'émetteur se corrige", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `nom-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const dossiers = {
    autonome: { id: "", mf: matriculeDEssai("A", "M") },
    mandat: { id: "", mf: matriculeDEssai("B", "M") },
  };
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let cabinet = "";
  let packId = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const pmeFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(dirigeant.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  let n = 0;
  /** Une facture d'achat lue, dont l'émetteur est lu « MITEK ». */
  const lue = async (mode: keyof typeof dossiers) => {
    n += 1;
    const d = dossiers[mode];
    const l = lectureDEssai({ clientMf: d.mf, numero: `NOM-${n}` });
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: d.id,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
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
              extract: { ...l.extract, issuer: LU },
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: "facture_achat",
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

  const dossierDe = (id: string) =>
    pmeFait("capture.dossier", id) as Promise<{
      extraction: { payload: { issuer?: string } } | null;
      precisions: Record<string, string>;
    }>;
  const nomsDits = async (id: string) =>
    (
      await admin.query<{ valeur: string }>(
        `select valeur from capture.precisions
          where piece_id = $1 and champ = 'issuer' order by decided_at`,
        [id],
      )
    ).rows.map((r) => r.valeur);

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant && expert);
    const creer = (u: Utilisateur, kind: string, nom: string, mode: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, 'TN', 'TND') as id`,
          [kind, nom, mode, mf],
        );
        return rows[0]!.id;
      });
    cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${marque}`, "mandate", null);
    for (const mode of ["autonome", "mandat"] as const) {
      const d = dossiers[mode];
      d.id = await creer(
        dirigeant,
        "pme",
        `PME ${mode.toUpperCase()} ${marque}`,
        mode === "mandat" ? "mandate" : "autonome",
        d.mf,
      );
      if (mode === "mandat") {
        await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, d.mf));
        const [propose] = await sousIdentite(dirigeant.id, (db) =>
          identite.mandatsProposes(db, d.id),
        );
        await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
      }
    }
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
        [[cabinet, dossiers.autonome.id, dossiers.mandat.id].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("la correction est une précision : la fiche et la liste portent le nom, la lecture reste", async () => {
    const id = await lue("autonome");
    const r = (await pmeFait("capture.preciser", id, "issuer", `  ${IMPRIME}  `)) as {
      id: string | null;
      valeur: string;
    };
    assert.ok(r.id, "une précision est écrite");
    assert.equal(r.valeur, IMPRIME, "les blancs se resserrent");

    const fiche = await dossierDe(id);
    assert.equal(fiche.extraction?.payload.issuer, IMPRIME);
    assert.equal(fiche.precisions["issuer"], IMPRIME);

    const liste = (await pmeFait("capture.listAvecLecture", dossiers.autonome.id)) as Array<{
      id: string;
      emetteur: string | null;
    }>;
    assert.equal(liste.find((p) => p.id === id)?.emetteur, IMPRIME);

    const { rows } = await admin.query<{ issuer: string }>(
      `select payload ->> 'issuer' as issuer from capture.extractions
        where piece_id = $1 order by created_at desc limit 1`,
      [id],
    );
    assert.equal(rows[0]?.issuer, LU, "la lecture n'est jamais modifiée (R7)");

    const { rows: journal } = await admin.query<{ payload: { avant: string; valeur: string } }>(
      `select payload from audit.event_log
        where action = 'piece.precisee' and payload ->> 'piece_id' = $1::text
          and payload ->> 'champ' = 'issuer'`,
      [id],
    );
    assert.deepEqual(
      journal.map((j) => [j.payload.avant, j.payload.valeur]),
      [[LU, IMPRIME]],
      "le journal garde ce qui était retenu avant",
    );
  });

  it("le jugement lit le nom corrigé", async () => {
    const id = await lue("autonome");
    await pmeFait("capture.preciser", id, "issuer", IMPRIME);
    await pmeFait("capture.analyser", id);
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from capture.analyses where piece_id = $1`,
      [id],
    );
    assert.ok(rows[0]!.n >= 2, "la pièce est rejugée");
    // L'écriture proposée nomme le tiers par le nom corrigé, jamais par le logo.
    const p = await pmeFait("office.propositionDePiece", id);
    const texte = JSON.stringify(p);
    assert.ok(texte.includes(IMPRIME), texte);
    assert.ok(!texte.includes(LU), texte);
  });

  it("redire le même nom n'écrit rien", async () => {
    const id = await lue("autonome");
    await pmeFait("capture.preciser", id, "issuer", IMPRIME);
    const r = (await pmeFait("capture.preciser", id, "issuer", IMPRIME)) as { id: string | null };
    assert.equal(r.id, null);
    assert.deepEqual(await nomsDits(id), [IMPRIME]);
  });

  it("un nom vide ou trop long est refusé", async () => {
    const id = await lue("autonome");
    await assert.rejects(pmeFait("capture.preciser", id, "issuer", "   "), /nom_vide/);
    await assert.rejects(
      pmeFait("capture.preciser", id, "issuer", "x".repeat(201)),
      /nom_trop_long/,
    );
    assert.deepEqual(await nomsDits(id), []);
  });

  it("dans un dossier tenu par le cabinet, la PME corrige le nom", async () => {
    const id = await lue("mandat");
    await pmeFait("capture.preciser", id, "issuer", IMPRIME);
    assert.deepEqual(await nomsDits(id), [IMPRIME]);
  });

  it("une pièce engagée ne se corrige plus", async () => {
    const id = await lue("autonome");
    await admin.query(`update capture.pieces set status = 'proposee' where id = $1`, [id]);
    await assert.rejects(pmeFait("capture.preciser", id, "issuer", IMPRIME), /engagee/);
  });
});
