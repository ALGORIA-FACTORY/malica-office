/**
 * Le sens corrigé après la lecture replace les parties, sans relire l'image.
 *
 * Le dirigeant, 5 novembre 2026 : l'utilisateur identifie le sens (achat ou vente) et peut
 * le corriger après la lecture ; le comptable aussi. Option A : la lecture se rejoue sur ses
 * jetons gardés avec le sens confirmé, et le matricule du dossier place les parties
 * (`parties-selon-le-sens.ts`).
 *
 * Le cas : la lecture a rangé le matricule du dossier dans la case de l'ÉMETTEUR (une
 * vente devinée). La personne répond « achat ». Avant, le jugement lisait la case du
 * client — le fournisseur — et rejetait la pièce : « la pièce concerne … pas le dossier ».
 *
 *   node --experimental-strip-types --test src/scan/le-sens-corrige-replace-les-parties.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

type Controle = { code: string; statut: string; motif?: string };

describe("le sens corrigé replace les parties", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `sens-${Date.now()}`;
  const dossierMf = matriculeDEssai("A", "M");
  const fournisseurMf = matriculeDEssai("A", "M");
  let u: Utilisateur;
  let org = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** Une facture lue : le fournisseur en tête, le dossier sous « Client : ». */
  const jetons: Array<[string, number, number]> = [
    ["COMPTOIR", 0.05, 0.05],
    ["DU", 0.15, 0.05],
    ["CENTRE", 0.2, 0.05],
    ["SUARL", 0.28, 0.05],
    ["MF", 0.05, 0.08],
    [":", 0.08, 0.08],
    [fournisseurMf, 0.1, 0.08],
    ["Client", 0.55, 0.16],
    [":", 0.62, 0.16],
    ["ALGORIA", 0.55, 0.18],
    ["FACTORY", 0.65, 0.18],
    ["SUARL", 0.75, 0.18],
    ["MF", 0.55, 0.2],
    [":", 0.58, 0.2],
    [dossierMf, 0.6, 0.2],
  ];

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           $1, 'TN', 'TND') as id`,
        [dossierMf],
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

  it("la réponse « achat » range le dossier en client : il n'est plus rejeté", async () => {
    const id = (
      (await rpc("capture", "enregistrer", {
        tenantId: org,
        source: "pdf",
        vis: "personnel",
        idempotencyKey: `${marque}-1`,
        contentType: "application/pdf",
        pageCount: 1,
      })) as { id: string }
    ).id;
    await admin(async (p) => {
      // la lecture a deviné une vente : le dossier dans la case de l'émetteur
      const { rows } = await p.query<{ id: string }>(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload)
         values ($1, $2, 'extract.v1', $3::jsonb) returning id`,
        [
          org,
          id,
          JSON.stringify({
            issuer: "COMPTOIR DU CENTRE SUARL",
            document_date: "2026-11-02",
            references: { matricule_fiscal: dossierMf, matricule_fiscal_client: fournisseurMf },
          }),
        ],
      );
      for (const [k, [texte, x, y]] of jetons.entries())
        await p.query(
          `insert into capture.token_plan
             (tenant_id, piece_id, extraction_id, page, ordinal, text, x0, y0, x1, y1)
           values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)`,
          [org, id, rows[0]!.id, k, texte, x, y, x + 0.008 * texte.length, y + 0.012],
        );
    });
    await rpc("capture", "preciser", id, "document_kind", "facture_achat");
    const analyse = (await rpc("capture", "analyser", id)) as { controles: Controle[] };
    const destinataire = analyse.controles.find((c) => c.code === "destinataire");
    assert.ok(destinataire, JSON.stringify(analyse.controles));
    assert.notEqual(destinataire.statut, "rejet", destinataire.motif);
  });
});
