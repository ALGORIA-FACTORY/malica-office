/**
 * Une recette qui désigne laisse une trace — en base, pas dans un commentaire.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/malica/lecture/une-recette-qui-designe-se-journalise.test.ts
 *
 * ================================================================= POURQUOI
 *
 * Le défaut a été nommé TROIS fois dans ce dépôt, et il a coûté dix jours de
 * mesures la première : `agents.model_pricing` cherche un tarif par le COUPLE
 * (modèle, rôle), et un couple absent fait REFUSER L'ÉCRITURE EN SILENCE.
 * `read-flow.ts` attrape cette levée et crie, mais ne fait pas échouer la
 * lecture — ce qui est juste, et ce qui rend l'absence invisible.
 *
 * Appeler la fonction ne prouve donc rien. Cette épreuve VÉRIFIE EN BASE
 * qu'une ligne s'écrit, sous une identité réelle, par le vrai chemin.
 *
 * Elle tient aussi ce que la mesure exige du plan de la fabrique : après
 * coup, on doit pouvoir répondre à « cette pièce a-t-elle été lue par une
 * recette ou par le modèle ? laquelle, dans quelle version, et si abstention
 * pour quel motif ? ».
 *
 * Aucun appel de modèle, aucun fournisseur payant : le plan de jetons est
 * synthétique, et la désignation est déterministe par construction.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../../auth.ts";
import { fermerLePool, sousIdentite, type Requete } from "../../db.ts";
import { RECETTE_FACTURE_A } from "../../fabrique/interprete-recettes-synthetiques.ts";
import { executerRpc } from "../../rpc.ts";
import {
  FACTURE_A,
  FACTURE_A_AUTRES_VALEURS,
} from "../../fabrique/signature-plans-synthetiques.ts";
import { MODELE_RECETTE, ROLE_RECETTE } from "../modeles.ts";

import { designerParRecette, type ContexteDeFabrique } from "./par-recette.ts";
import type { PageToken } from "./token-plan.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/*
 * Les dépôts sont appelés PAR LE TRANSPORT, et non importés un par un.
 *
 * Ce n'est pas une préférence : `depots/capture.ts` et `rpc.ts` se citent en
 * cercle (par `malica/appel-local.ts`), et un module importé directement
 * depuis un banc tombe sur « Cannot access 'capture' before initialization ».
 * C'est aussi le chemin que la production emprunte, ce qui vaut mieux.
 */
function appeler<T>(utilisateur: string, depot: string, methode: string, args: unknown[]) {
  return sousIdentite(utilisateur, async (db) =>
    executerRpc(db, { depot, methode, args }),
  ) as Promise<T>;
}

describe("une recette qui désigne se journalise", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rec-${Date.now()}`;
  let moi: Utilisateur;
  let org = "";
  let pieceLue = "";
  const exemples: string[] = [];
  let versionId = "";
  let admin: pg.Pool;

  /** Une pièce, et le plan de jetons qu'une lecture y aurait posé. */
  async function pieceAvecPlan(db: Requete, suffixe: string, plan: PageToken[]): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
       values ($1, 'pdf', 'partage', $2, $3) returning id`,
      [org, `essai/${marque}-${suffixe}.pdf`, `${marque}-${suffixe}`],
    );
    const piece = rows[0]!.id;
    for (const t of plan) {
      await db.query(
        `insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text, x0, y0, x1, y1)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [org, piece, t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1],
      );
    }
    return piece;
  }

  before(async () => {
    const compte = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compte);
    moi = compte;

    await sousIdentite(moi.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `RECETTE ${marque}`, "autonome", "TN", "TND"],
      );
      org = rows[0]!.org;

      pieceLue = await pieceAvecPlan(db, "lue", FACTURE_A());
      exemples.push(await pieceAvecPlan(db, "ex1", FACTURE_A()));
      exemples.push(await pieceAvecPlan(db, "ex2", FACTURE_A_AUTRES_VALEURS()));

      // La recette, sa version, ses deux exemples d'APPRENTISSAGE.
      const recette = await db.query<{ id: string }>(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, $2, $3, 'organisation') returning id`,
        [org, `facture ${marque}`, `sig-${marque}`],
      );
      const definition = JSON.stringify(RECETTE_FACTURE_A);
      const version = await db.query<{ id: string }>(
        `insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte)
         values ($1, $2, 1, $3::jsonb, $4) returning id`,
        [
          org,
          recette.rows[0]!.id,
          definition,
          createHash("sha256").update(definition).digest("hex"),
        ],
      );
      versionId = version.rows[0]!.id;

      for (const piece of exemples) {
        const ex = await db.query<{ id: string }>(
          `insert into fabrique.exemples
             (tenant_id, piece_id, signature_cle, provenance, qualification, usage, attendu)
           values ($1, $2, $3, 'validation_humaine', 'designation_champ', 'apprentissage', '{}'::jsonb)
           returning id`,
          [org, piece, `sig-${marque}`],
        );
        await db.query(
          `insert into fabrique.recette_version_exemples
             (tenant_id, recette_version_id, exemple_id, nourrit_une_recette, usage)
           values ($1, $2, $3, true, 'apprentissage')`,
          [org, versionId, ex.rows[0]!.id],
        );
      }

      /*
       * ============================== R10, DE BOUT EN BOUT, ET CE N'EST PAS DÉCORATIF
       *
       * Le pack livre `ancre_texte_min = 3`, et sa migration le dit en toutes
       * lettres : « un POINT DE DÉPART À MESURER, pas un relevé ». La recette
       * de banc s'appuie sur « HT » et « Qte » — deux caractères, les
       * libellés que la pièce IMPRIME — et le validateur la refuse donc avec
       * `ANCRE_TROP_COURTE`. Constaté ici, en base, au premier passage.
       *
       * Ce n'est pas un défaut du branchement : c'est exactement le cas que
       * R10 prévoit. Le cabinet ARRÊTE sa borne au-dessus du défaut livré,
       * sans migration ni déploiement, et la ligne suivante est ce geste.
       */
      await db.query(
        `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, 'fabrique.seuil.recette.ancre_texte_min', 2, $2)`,
        [org, "les libellés de ce format tiennent en deux caractères"],
      );

      /*
       * Le cycle de vie est tenu par la base : candidate, puis évaluée, puis
       * observation — et les deux derniers exigent une ÉVALUATION, parce
       * qu'« une validation humaine n'en tient pas lieu ». On n'active pas :
       * « toute recette naît en observation », et c'est l'état sous lequel
       * le branchement la fait tourner.
       */
      await db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'candidate', 'épreuve automatisée')`,
        [org, versionId],
      );
      const evaluation = await db.query<{ id: string }>(
        `insert into fabrique.evaluations
           (tenant_id, recette_version_id, mesures, exemples_comptes)
         values ($1, $2, '{"exactitude_champs_critiques": 1}'::jsonb, 2) returning id`,
        [org, versionId],
      );
      for (const etat of ["evaluee", "observation"]) {
        await db.query(
          `insert into fabrique.promotions
             (tenant_id, recette_version_id, etat, evaluation_id, motif)
           values ($1, $2, $3::fabrique.etat_t, $4, 'épreuve automatisée')`,
          [org, versionId, etat, evaluation.rows[0]!.id],
        );
      }
    });

    const url = process.env["DATABASE_URL_ADMIN"];
    assert.ok(url, "DATABASE_URL_ADMIN absente : l'archivage des fixtures n'est pas possible");
    admin = new pg.Pool({ connectionString: url });
  });

  after(async () => {
    if (BASE_CONFIGUREE && admin && org) {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [org],
      );
      await admin.end();
    }
    await fermerLePool();
  });

  it("le contexte de désignation rend la version en observation, et SES exemples", async () => {
    const ctx = await appeler<ContexteDeFabrique>(moi.id, "fabrique", "contexteDeDesignation", [
      org,
    ]);
    assert.equal(ctx.versions.length, 1);
    const v = ctx.versions[0]!;
    assert.equal(v.versionId, versionId);
    assert.equal(v.etat, "observation");
    assert.equal(
      v.plansDApprentissage.length,
      2,
      "les DEUX exemples d'apprentissage, sinon l'ossature n'existe pas",
    );
    // Les treize réglages et les cinq bornes viennent du référentiel : si l'un
    // manquait, la lecture aurait LEVÉ, et c'est ce qu'on veut (R4).
    assert.ok(ctx.signature.recouvrementDeLigne > 0);
    assert.ok(ctx.bornes.champs_max > 0);
  });

  it("la recette désigne, et SON exécution s'inscrit en base", async () => {
    const ctx = await appeler<ContexteDeFabrique>(moi.id, "fabrique", "contexteDeDesignation", [
      org,
    ]);

    const r = designerParRecette(FACTURE_A(), ctx, { devise: "TND", neutreDeConfiance: 1 });
    assert.ok(r.applique, r.applique === false ? JSON.stringify(r.pourquoi) : "");

    await appeler(moi.id, "fabrique", "inscrireExecution", [
      {
        tenantId: org,
        recetteVersionId: r.par.versionId,
        pieceId: pieceLue,
        issue: "designation",
        champsDesignes: r.par.champsDesignes,
        dureeMs: r.par.dureeMs,
      },
    ]);

    const lignes = await sousIdentite(moi.id, async (db) => {
      const { rows } = await db.query<{
        issue: string;
        champs_designes: number;
        recette_version_id: string;
      }>(
        `select issue::text as issue, champs_designes, recette_version_id
           from fabrique.executions where piece_id = $1`,
        [pieceLue],
      );
      return rows;
    });
    assert.equal(lignes.length, 1, "une exécution, et elle est LUE en base");
    assert.equal(lignes[0]!.issue, "designation");
    assert.equal(lignes[0]!.recette_version_id, versionId);
    assert.ok(
      Number(lignes[0]!.champs_designes) > 0,
      "on doit savoir combien de champs la recette a tenus",
    );
  });

  it("une abstention s'inscrit AVEC son motif — sinon la base refuse", async () => {
    await appeler(moi.id, "fabrique", "inscrireExecution", [
      {
        tenantId: org,
        recetteVersionId: versionId,
        pieceId: exemples[0]!,
        issue: "abstention",
        motif: "totals.vat:TOKEN_NOT_FOUND",
      },
    ]);
    const motif = await sousIdentite(moi.id, async (db) => {
      const { rows } = await db.query<{ motif: string }>(
        `select motif from fabrique.executions where piece_id = $1 and issue = 'abstention'`,
        [exemples[0]!],
      );
      return rows[0]?.motif ?? null;
    });
    assert.match(String(motif), /TOKEN_NOT_FOUND/);

    // Le `check` de la base, et non une vérification de l'application : une
    // abstention sans motif est une tâche oubliée déguisée en fait acquis.
    await assert.rejects(() =>
      appeler(moi.id, "fabrique", "inscrireExecution", [
        {
          tenantId: org,
          recetteVersionId: versionId,
          pieceId: exemples[1]!,
          issue: "abstention",
        },
      ]),
    );
  });

  it("LE PIÈGE NOMMÉ TROIS FOIS : le couple (recette/1, recette) a son tarif", async () => {
    /*
     * C'est la seule preuve qui compte. `public.agents_run_log` LÈVE quand il
     * ne trouve pas de tarif pour le couple, et `read-flow.ts` attrape cette
     * levée en criant : une lecture par recette tournerait donc sans laisser
     * ni coût ni latence, et le RECOURS AU MODÈLE que le plan demande de
     * mesurer serait incomptable.
     */
    const id = await appeler<string | null>(moi.id, "capture", "journaliserAgent", [
      {
        tenantId: org,
        agent: "malica.lecture.designation",
        model: MODELE_RECETTE,
        role: ROLE_RECETTE,
        status: "ok",
        latencyMs: 3,
        tokensIn: null,
        tokensOut: null,
        pieceId: pieceLue,
      },
    ]);
    assert.ok(id, "l'écriture du journal doit rendre un identifiant, pas null");

    const ligne = await sousIdentite(moi.id, async (db) => {
      const { rows } = await db.query<{ model: string; cost: string; sovereign: boolean }>(
        `select model, cost::text as cost, sovereign
           from public.agent_runs_v where id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    assert.ok(ligne, "la ligne doit être LISIBLE en base, pas seulement écrite");
    assert.equal(ligne.model, MODELE_RECETTE);
    assert.equal(ligne.sovereign, true, "une interprétation déterministe ne sort d'aucune machine");
    assert.equal(Number(ligne.cost), 0);
  });
});
