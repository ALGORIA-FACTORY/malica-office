/**
 * Le journal d'audit suit la pièce (revue indépendante de #146, P1).
 *
 * Le lot 4 écrit au journal d'audit des textes privés : la note du
 * propriétaire qui retourne une pièce à un siège, la réponse du siège. La
 * politique `audit_event_log_sel` ouvrait TOUT le journal à tout membre de la
 * société, et au cabinet engagé : un siège lisait les notes d'un autre, et le
 * cabinet l'échange siège ↔ propriétaire sur une pièce jamais envoyée.
 *
 * Une épreuve par lecteur du journal : `supervision.auditForPiece`,
 * `supervision.journalDuMandat`, `banque.audit`, le refus de lecture de
 * `capture.listAvecLecture`, la qualification d'un règlement lue par le cabinet.
 *
 *   node --experimental-strip-types --test src/le-journal-d-audit-suit-la-piece.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

describe("le journal d'audit suit la pièce", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  /** La pièce de Sami, retournée par le propriétaire avec une note, puis répondue. */
  let interne = "";
  /** La pièce de Sami, passée chez le comptable. */
  let partie = "";

  before(async () => {
    s = await monterUneSociete(`audit-${Date.now()}`);
    interne = await s.deposer("sami", "entite");
    await s.lire("sami", interne);
    await s.fait("sami", "collab.envoyer", interne);
    await s.fait("amel", "supervision.retourner", {
      pieceId: interne,
      motifId: s.motifs["piece_illisible"],
      note: "NOTE-PRIVEE-DU-PROPRIETAIRE",
    });
    await s.fait("sami", "capture.repondreAuCabinet", interne, "REPONSE-PRIVEE-DU-SIEGE");
    partie = await s.deposer("sami", "entite");
    await s.lire("sami", partie);
    await s.fait("sami", "collab.envoyer", partie);
    await s.fait("amel", "collab.envoyer", partie);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const piste = (qui: Personne, id: string) =>
    s.fait(qui, "supervision.auditForPiece", id) as Promise<
      Array<{ action: string; payload: unknown }>
    >;

  it("auditForPiece : un autre siège ne lit rien de la pièce ; son auteur et le propriétaire la lisent", async () => {
    assert.deepEqual(await piste("sonia", interne), []);
    for (const qui of ["sami", "amel"] as const)
      assert.ok(
        JSON.stringify(await piste(qui, interne)).includes("NOTE-PRIVEE-DU-PROPRIETAIRE"),
        qui,
      );
  });

  it("auditForPiece : le cabinet ne lit jamais l'échange siège ↔ propriétaire", async () => {
    assert.deepEqual(await piste("expert", interne), [], "pièce jamais envoyée");
    const chezLui = await piste("expert", partie);
    assert.ok(
      chezLui.some((e) => e.action === "piece.vis_changed"),
      "ce qu'il a reçu, il le lit",
    );
    assert.ok(
      !chezLui.some((e) => (e.payload as { chez?: string } | null)?.chez === "proprietaire"),
      "jamais le passage interne",
    );
  });

  it("journalDuMandat : un siège ne liste que ses faits et ceux de ses pièces", async () => {
    const journal = (await s.fait("sonia", "supervision.journalDuMandat", s.pme, 200)) as Array<{
      objetId: string | null;
    }>;
    assert.ok(!journal.some((e) => e.objetId === interne || e.objetId === partie));
    const duProprietaire = (await s.fait(
      "amel",
      "supervision.journalDuMandat",
      s.pme,
      200,
    )) as Array<{
      objetId: string | null;
    }>;
    assert.ok(duProprietaire.some((e) => e.objetId === interne));
  });

  it("sous l'identité d'un siège, la vue du journal ne rend rien d'une pièce qu'il ne lit pas", async () => {
    const lignes = await sousIdentiteDuServeur(
      s.gens.sonia.id,
      async (db) =>
        (await db.query(`select 1 from event_log_v where object_id = $1`, [interne])).rows.length,
    );
    assert.equal(lignes, 0);
  });

  it("banque.audit : le propriétaire lit le journal de la banque, un siège n'y lit que ses faits", async () => {
    await s.admin.query(
      `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, payload)
       values ($1, $2, 'banque.essai', 'banque', 'releves', '{}'::jsonb)`,
      [s.pme, s.gens.amel.id],
    );
    const proprietaire = (await s.fait("amel", "banque.audit", s.pme)) as unknown[];
    const siege = (await s.fait("sonia", "banque.audit", s.pme)) as unknown[];
    assert.ok(proprietaire.length >= 1);
    assert.equal(siege.length, 0);
  });

  it("le refus de lecture inscrit au journal se lit toujours sur la pièce de son auteur", async () => {
    const id = await s.deposer("sami", "entite");
    await s.admin.query(
      `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
       values ($1, $2, 'lecture.refusee', 'capture', 'pieces', $3, '{"motif":"plafond_atteint"}'::jsonb)`,
      // Écrit par un autre que l'auteur : c'est la pièce qui ouvre la ligne.
      [s.pme, s.gens.amel.id, id],
    );
    const liste = (await s.fait("sami", "capture.listAvecLecture", s.pme)) as Array<{
      id: string;
      lectureRefusee: { motif: string } | null;
    }>;
    assert.equal(liste.find((p) => p.id === id)?.lectureRefusee?.motif, "plafond_atteint");
  });

  it("la qualification d'un règlement reste lisible du cabinet (journal d'une écriture partagée)", async () => {
    const ecriture = await s.priseEnCharge(partie);
    await s.admin.query(
      `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
       values ($1, $2, 'reglement.qualifie', 'socle', 'ecritures', $3, '{"qualification":"essai"}'::jsonb)`,
      [s.pme, s.gens.expert.id, ecriture],
    );
    const lu = await sousIdentiteDuServeur(
      s.gens.expert.id,
      async (db) =>
        (
          await db.query(
            `select 1 from audit.event_log where object_id = $1 and action = 'reglement.qualifie'`,
            [ecriture],
          )
        ).rows.length,
    );
    assert.equal(lu, 1);
  });
});
