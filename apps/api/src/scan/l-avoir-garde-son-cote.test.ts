/**
 * L'avoir garde son côté : achat ou vente, dit par la personne.
 *
 * Le dirigeant, 21 novembre 2026, sur un avoir de vente : « lorsque je clique Avoir en bas,
 * le bouton en haut revient à l'achat ». Le type « avoir » est le même code des deux côtés ;
 * le type seul perdait le côté choisi, et le jugement prenait « avoir » pour le sens.
 *
 *   - un dossier autonome dit le côté (précision `sens`) : la liste range l'avoir en vente ;
 *   - en mandat, la PME PROPOSE (`sens_propose`, « à confirmer »), rien ne bloque ;
 *   - le cabinet confirme en tranchant le sens : l'avoir reste un avoir ;
 *   - la PME ne défait pas le côté que le cabinet a établi ;
 *   - un type qui fixe déjà le côté (une facture) ne prend pas de précision `sens`.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/scan/l-avoir-garde-son-cote.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../db.ts";
import { identite } from "../depots/identite.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";
import { organisationDEssai } from "../organisation-d-essai.ts";
import { lecture as lectureDEssai } from "./lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("l'avoir garde son côté", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `cote-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const dossiers = {
    mandat: { id: "", mf: matriculeDEssai("A", "M") },
    autonome: { id: "", mf: matriculeDEssai("B", "M") },
  };
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let cabinet = "";
  let packId = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  let n = 0;
  /** Un avoir confirmé comme tel, de la société, partagé au cabinet en mandat. */
  const unAvoir = async (mode: keyof typeof dossiers) => {
    n += 1;
    const p = (await rpc(dirigeant, "capture.enregistrer", {
      tenantId: dossiers[mode].id,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    // Lue « achat » : c'est le côté que l'avoir prenait faute de mieux.
    const l = lectureDEssai({ clientMf: dossiers[mode].mf, numero: `AV-${n}` });
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
              extract: l.extract,
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
    await rpc(dirigeant, "capture.preciser", p.id, "document_kind", "avoir");
    if (mode === "mandat") await rpc(dirigeant, "collab.setPieceVis", p.id, "partage");
    return p.id;
  };
  const cotes = async (id: string) =>
    (
      await admin.query<{ champ: string; valeur: string }>(
        `select champ, valeur from capture.precisions
          where piece_id = $1 and champ in ('sens', 'sens_propose') order by decided_at`,
        [id],
      )
    ).rows;
  const dansLaListe = async (mode: keyof typeof dossiers, id: string) => {
    const [societe] = (await rpc(dirigeant, "capture.listAvecLectureDesSocietes", [
      dossiers[mode].id,
    ])) as Array<{
      pieces: Array<{ id: string; kind: string | null; sensAConfirmer?: boolean }>;
    }>;
    return societe!.pieces.find((p) => p.id === id)!;
  };

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    const creer = (u: Utilisateur, kind: string, nom: string, mode: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await organisationDEssai(db, `$1, $2, $3, $4, 'TN', 'TND'`, [
          kind,
          nom,
          mode,
          mf,
        ]);
        return rows[0]!.id;
      });
    cabinet = await creer(expert, "cabinet", `CABINET ${marque}`, "mandate", null);
    for (const mode of ["mandat", "autonome"] as const) {
      const d = dossiers[mode];
      d.id = await creer(
        dirigeant,
        "pme",
        `PME ${mode} ${marque}`,
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
        [[cabinet, dossiers.mandat.id, dossiers.autonome.id].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("un dossier autonome dit le côté : l'avoir se range en vente", async () => {
    const id = await unAvoir("autonome");
    const r = (await rpc(dirigeant, "capture.preciser", id, "sens", "facture_vente")) as {
      champ: string;
    };
    assert.equal(r.champ, "sens");
    assert.deepEqual(await cotes(id), [{ champ: "sens", valeur: "facture_vente" }]);
    const p = await dansLaListe("autonome", id);
    assert.equal(p.kind, "facture_vente");
    assert.equal(p.sensAConfirmer, false);
    const { rows } = await admin.query<{ document_kind: string }>(
      `select document_kind from capture.pieces where id = $1`,
      [id],
    );
    assert.equal(rows[0]?.document_kind, "avoir", "l'avoir reste un avoir");
  });

  it("en mandat, la PME propose le côté au cabinet, sans être bloquée", async () => {
    const id = await unAvoir("mandat");
    const r = (await rpc(dirigeant, "capture.preciser", id, "sens", "facture_vente")) as {
      champ: string;
    };
    assert.equal(r.champ, "sens_propose");
    const p = await dansLaListe("mandat", id);
    assert.equal(p.kind, "facture_vente", "la PME voit son avoir en vente");
    assert.equal(p.sensAConfirmer, true);
  });

  it("le cabinet confirme : l'avoir reste un avoir, et la PME ne le défait plus", async () => {
    const id = await unAvoir("mandat");
    await rpc(dirigeant, "capture.preciser", id, "sens", "facture_vente");
    const t = (await rpc(expert, "office.trancherLeSens", id, "facture_vente")) as {
      type: string;
    };
    assert.equal(t.type, "avoir");
    assert.deepEqual(await cotes(id), [
      { champ: "sens_propose", valeur: "facture_vente" },
      { champ: "sens", valeur: "facture_vente" },
    ]);
    const { rows } = await admin.query<{ document_kind: string }>(
      `select document_kind from capture.pieces where id = $1`,
      [id],
    );
    assert.equal(rows[0]?.document_kind, "avoir");
    assert.equal((await dansLaListe("mandat", id)).sensAConfirmer, false);
    await assert.rejects(
      rpc(dirigeant, "capture.preciser", id, "sens", "facture_achat"),
      /refus\.sens\.reserve_au_cabinet/,
    );
  });

  it("une facture dit déjà son côté ; un côté inconnu est refusé", async () => {
    const id = await unAvoir("autonome");
    await assert.rejects(
      rpc(dirigeant, "capture.preciser", id, "sens", "achat"),
      /refus\.precision\.sens_inconnu/,
    );
    await rpc(dirigeant, "capture.preciser", id, "document_kind", "facture_achat");
    await assert.rejects(
      rpc(dirigeant, "capture.preciser", id, "sens", "facture_vente"),
      /refus\.precision\.sens_sans_objet/,
    );
  });
});
