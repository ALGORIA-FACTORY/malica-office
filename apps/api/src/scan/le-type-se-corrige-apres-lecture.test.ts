/**
 * Le type d'une pièce se dit court et se corrige après la lecture
 * (23 octobre 2026, demande de Wissem).
 *
 * La correction admet ce que le référentiel propose au choix, et rien d'autre ;
 * une pièce engagée ne se reclasse plus ; la trace garde le type d'avant ; et
 * l'écran (`STATUTS_PRECISABLES`) dit la même chose que la base.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { STATUTS_PRECISABLES } from "@malica/socle/statut-de-la-piece";
import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le type d'une pièce se corrige après la lecture", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `retype-${Date.now()}`;
  let dirigeant: Utilisateur;
  let pme = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const piece = async (cle: string, statut: string) => {
    const id = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key,
                                     created_by, document_kind, document_kind_statut)
         values ($1, 'pdf', 'entite', $2, $3, $4, 'facture_achat', 'a_confirmer') returning id`,
        [pme, `essai/${marque}-${cle}.pdf`, `${marque}-${cle}`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    if (statut !== "capturee") {
      await admin.query("update capture.pieces set status = $2 where id = $1", [id, statut]);
    }
    return id;
  };

  const preciser = (id: string, valeur: string) =>
    sousIdentite(dirigeant.id, (db) =>
      db.query("select public.capture_precision_persist($1, 'document_kind', $2)", [id, valeur]),
    );

  before(async () => {
    const d = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d);
    dirigeant = d;
    pme = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME ${marque}`, matriculeDEssai()],
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [pme],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("une facture lue se reclasse en reçu ; le type d'avant reste dans la trace", async () => {
    const id = await piece("lue", "lue");
    await preciser(id, "ticket_caisse");
    const { rows } = await admin.query<{ document_kind: string; document_kind_statut: string }>(
      "select document_kind, document_kind_statut from capture.pieces where id = $1",
      [id],
    );
    assert.deepEqual(rows[0], { document_kind: "ticket_caisse", document_kind_statut: "confirme" });
    const trace = await admin.query<{ avant: string }>(
      `select payload ->> 'avant' as avant from audit.event_log
        where action = 'piece.precisee' and payload ->> 'piece_id' = $1`,
      [id],
    );
    assert.equal(trace.rows[0]?.avant, "facture_achat");
  });

  it("le dossier rend le type corrigé, même quand la lecture en avait lu un autre", async () => {
    const id = await piece("rendu", "lue");
    await admin.query(
      `insert into capture.extractions (tenant_id, piece_id, contract, payload)
       values ($1, $2, 'extract.v1', '{"document_kind": "facture_vente"}'::jsonb)`,
      [pme, id],
    );
    await preciser(id, "ticket_caisse");
    // Par le transport, comme en production : `depots/capture.ts` et
    // `rpc.ts` se citent en cercle, un import direct ne s'initialise pas.
    const d = (await sousIdentite(dirigeant.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "dossier", args: [id] }),
    )) as { extraction?: { payload?: unknown } };
    const payload = d.extraction?.payload as { document_kind?: string } | undefined;
    assert.equal(payload?.document_kind, "ticket_caisse");
    const brut = await admin.query<{ k: string }>(
      "select payload ->> 'document_kind' as k from capture.extractions where piece_id = $1",
      [id],
    );
    assert.equal(brut.rows[0]!.k, "facture_vente", "la lecture reste immuable");
  });

  it("un type que le référentiel ne propose pas au choix est refusé", async () => {
    const id = await piece("hors-liste", "lue");
    await assert.rejects(preciser(id, "justificatif_paiement"), /type de piece non propose/);
  });

  it("une pièce engagée ne se reclasse plus", async () => {
    const id = await piece("engagee", "comptabilisee");
    await assert.rejects(preciser(id, "facture_vente"), /piece engagee/);
  });

  it("l'écran et la base disent les mêmes états précisables", async () => {
    const { rows } = await admin.query<{ def: string }>(
      "select pg_get_functiondef('public.capture_precision_persist'::regproc) as def",
    );
    const liste = /v_status not in \(([^)]*)\)/.exec(rows[0]!.def)?.[1] ?? "";
    const base = new Set([...liste.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
    assert.deepEqual([...base].sort(), [...STATUTS_PRECISABLES].sort());
  });

  it("chaque type a un libellé dans les trois langues", async () => {
    const { rows } = await admin.query<{ code: string; locales: string | null }>(
      `select d.code, string_agg(l.locale, ',' order by l.locale) as locales
         from ref.document_types d
         left join ref.labels l on l.ns = 'document_type' and l.key = d.code
        group by d.code`,
    );
    const manquants = rows.filter((r) => r.locales !== "ar,en,fr").map((r) => r.code);
    assert.deepEqual(manquants, []);
  });
});
