/**
 * Le cycle de vie d'une recette, éprouvé de bout en bout — et EN BASE.
 *
 * Tout passe par `sousIdentiteDuServeur`, donc par le rôle `authenticated` avec le
 * claim `sub` posé dans la transaction, exactement comme une requête réelle.
 * C'est la quatrième règle du plan : une preuve obtenue en superutilisateur
 * ne prouve rien, parce qu'un superutilisateur n'est arrêté par aucune
 * politique. Sept désaccords, sept fois la lecture avait tort contre
 * l'exécution.
 *
 * Et tout passe par le DÉPÔT (`depots/fabrique.ts`), pas par les fonctions
 * nues : ce qui n'est appelé par personne n'est pas éprouvé, et `knip` a déjà
 * laissé passer cinq outils justes non branchés dans ce dépôt — dont celui
 * qui a coûté six mille dinars.
 *
 * Aucun fournisseur payant : le générateur reçoit un adaptateur SIMULÉ. Ce
 * que ce banc prouve, c'est le parcours et ses refus — pas la qualité du
 * modèle. Le vrai appel s'éprouve à la main, et la commande est dans
 * `docs/fabrique-de-lecteurs/01-generer-une-recette.md`.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/cycle.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur, type Requete } from "../db.ts";
import { fabrique } from "../depots/fabrique.ts";
import { MODELE_GENERATION, ROLE_GENERATION } from "../malica/modeles.ts";

import { MESURES_CONNUES } from "./cycle-mesures.ts";
import { proposerUneRecette, type AppelDeGenerateur } from "./generateur.ts";
import { lireLesBornesDeRecette, lireLesReglages } from "./interprete-reglages.ts";
import { VERSION_DU_LANGAGE } from "./recette.ts";
import {
  FACTURE_A,
  FACTURE_A_AUTRE_CLIENT,
  FACTURE_A_AUTRES_VALEURS,
  FACTURE_A_SIX_LIGNES,
} from "./signature-plans-synthetiques.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Le SQLSTATE d'une erreur `pg`, ou son message si elle n'en porte pas. */
function codeDe(erreur: unknown): string {
  const e = erreur as { code?: string; message?: string };
  return e.code ?? e.message ?? String(erreur);
}

/**
 * La recette que l'adaptateur simulé propose : le total HT, par son libellé.
 *
 * « Total » est sur trois lignes du pied — HT, TVA, TTC — donc c'est « HT »
 * qui tranche, et le montant est le nombre qui suit sur la même ligne.
 */
const RECETTE_HT: unknown = {
  version: VERSION_DU_LANGAGE,
  sens_de_lecture: "ltr",
  chiffres: "latins",
  ancres: {
    ht: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "HT" } },
      prendre: { genre: "unique" },
    },
  },
  champs: {
    "totals.base_ht": {
      designation: {
        depuis: { genre: "voisin", de: "ht", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "premier" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
};

const modeleSimule: AppelDeGenerateur = () =>
  Promise.resolve({
    recetteProposee: RECETTE_HT,
    modele: MODELE_GENERATION,
    role: ROLE_GENERATION,
    tokensIn: 2400,
    tokensOut: 620,
    latenceMs: 18000,
  });

/** Le jeton qui porte ce texte, dans ce plan. */
function ou(plan: readonly PageToken[], texte: string): TokenRef {
  const t = plan.find((x) => x.text === texte);
  assert.ok(t, `le plan synthétique ne porte pas « ${texte} »`);
  return { page: t.page, ordinal: t.ordinal };
}

describe("le cycle de vie d'une recette", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `cyc-${Date.now()}`;
  const signatureCle = `facture-a-${marque}`;
  let a: Utilisateur;
  let orgA = "";
  /** piece_id par nom de plan. */
  const pieces = new Map<string, string>();
  const plans = new Map<string, PageToken[]>();

  /** Dépose une pièce et son plan de jetons, par le vrai chemin. */
  async function deposer(db: Requete, nom: string, plan: PageToken[]): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
       values ($1, 'pdf', 'partage', $2, $3) returning id`,
      [orgA, `essai/${marque}-${nom}.pdf`, `${marque}-${nom}`],
    );
    const pieceId = rows[0]!.id;
    for (const t of plan) {
      await db.query(
        `insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text, x0, y0, x1, y1)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [orgA, pieceId, t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1],
      );
    }
    pieces.set(nom, pieceId);
    plans.set(nom, plan);
    return pieceId;
  }

  before(async () => {
    const compte = await creerCompte(`cycle-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compte, "le compte doit être créé");
    a = compte;

    await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `ESSAI ${marque}`, "autonome", "TN", "TND"],
      );
      orgA = rows[0]!.org;

      await deposer(db, "a", FACTURE_A());
      await deposer(db, "autre_client", FACTURE_A_AUTRE_CLIENT());
      await deposer(db, "autres_valeurs", FACTURE_A_AUTRES_VALEURS());
      await deposer(db, "six_lignes", FACTURE_A_SIX_LIGNES());

      /*
       * Le cabinet INSCRIT SA borne d'ancre, et la décision se lit (R10).
       *
       * Attention à ce que cette ligne prouve, et à ce qu'elle ne prouve plus.
       * Le pack a livré `ancre_texte_min = 3` — « un point de départ à
       * mesurer, pas un relevé », disait-il — et il livre **2** depuis
       * `20261020200000`, parce que la longueur ne prédit pas ce qu'une ancre
       * attrape (limite n° 4 de `02-ce-qui-est-livre.md`). La surcharge
       * ci-dessous vaut donc aujourd'hui le défaut : elle n'est plus ce qui
       * rend ce format lisible, elle est ce qui le rend lisible SANS DÉPENDRE
       * du défaut. C'est ce qu'on veut d'un banc de cycle — la raison reste
       * vraie : trois lignes du pied portent le mot « Total », et ce qui les
       * sépare, « HT » et « TTC », fait deux caractères.
       */
      await db.query(
        `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, 'fabrique.seuil.recette.ancre_texte_min', 2,
                 'les libellés de pied font deux caractères : HT, TTC')`,
        [orgA],
      );
    });
  });

  after(async () => {
    // On archive, on ne supprime pas : R7 tient `audit.event_log`, et une
    // suppression d'organisation y cascade puis échoue.
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (BASE_CONFIGUREE && admin && orgA) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = $1 and archived_at is null`,
          [orgA],
        );
      } finally {
        await pool.end();
      }
    }
    await fermerLePool();
  });

  /* ================================================== LES MESURES ======== */

  it("toute mesure exigée par le référentiel est une mesure qu'on sait calculer", async () => {
    /*
     * Le piège, écrit avant d'y tomber : `fabrique.verifier_promotion()`
     * parcourt TOUS les seuils en vigueur et exige, pour chacun, une clé dans
     * `mesures`. Un seuil ajouté au référentiel sans mesure correspondante
     * refuserait donc TOUTE activation — et le refus parlerait d'une mesure
     * manquante, pas d'un seuil orphelin. La relation se vérifie ici.
     */
    const exigees = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ mesure: string }>(
        `select mesure from fabrique.seuils_exiges($1)`,
        [orgA],
      );
      return rows.map((r) => r.mesure);
    });
    assert.ok(exigees.length > 0, "aucun seuil de promotion en vigueur");
    assert.deepEqual(
      exigees.filter((m) => !MESURES_CONNUES.includes(m as never)),
      [],
      "un seuil du référentiel nomme une mesure que l'évaluation ne produit pas : " +
        "aucune recette ne pourra plus être activée, et le refus nommera la mesure",
    );
  });

  /* =============================== LE PARCOURS COMPLET, DANS L'ORDRE ===== */

  it("exemples → candidate → évaluation → observation → active → suspension → reprise → retrait", async () => {
    /* --- ① Les exemples qualifiés. Deux pour apprendre, deux pour mesurer. */
    const ids = await sousIdentiteDuServeur(a.id, async (db) => {
      const apprentissage: string[] = [];
      for (const [nom, total] of [
        ["a", "1180,000"],
        ["autre_client", "708,000"],
      ] as const) {
        const qualifie = await fabrique.qualifierUnExemple(db, {
          tenantId: orgA,
          pieceId: pieces.get(nom),
          signatureCle,
          provenance: "validation_humaine",
          qualification: "designation_champ",
          usage: "apprentissage",
          attendu: { "totals.base_ht": ou(plans.get(nom)!, total) },
        });
        apprentissage.push(qualifie.exempleId);
      }
      for (const [nom, total] of [
        ["autres_valeurs", "3940,000"],
        ["six_lignes", "6600,000"],
      ] as const) {
        await fabrique.qualifierUnExemple(db, {
          tenantId: orgA,
          pieceId: pieces.get(nom),
          signatureCle,
          provenance: "import_expert",
          qualification: "designation_champ",
          usage: "evaluation",
          attendu: { "totals.base_ht": ou(plans.get(nom)!, total) },
        });
      }
      return apprentissage;
    });

    /* --- ② La proposition. Le générateur lit les exemples par le dépôt. */
    const propose = await sousIdentiteDuServeur(a.id, async (db) => {
      const exemples = await fabrique.exemplesDApprentissage(db, orgA, signatureCle);
      assert.equal(exemples.length, 2, "les exemples d'évaluation ont fui dans l'apprentissage");
      const [reglages, bornes] = await Promise.all([
        lireLesReglages(db, orgA),
        lireLesBornesDeRecette(db, orgA),
      ]);
      assert.equal(bornes.ancre_texte_min, 2, "la surcharge du cabinet n'est pas lue");
      // Les codes du pack de l'organisation, lus en base : aucun code n'est
      // écrit ici (R4), et une organisation sans juridiction lèverait.
      const codes = await fabrique.codesDuReferentiel(db, orgA);
      assert.ok(codes.taux.length > 0, "le pack ne rend aucun code de taux");
      return proposerUneRecette(
        exemples.map((e) => ({
          pieceId: e.pieceId,
          plan: e.plan,
          attendu: (e.attendu as { champs: Record<string, TokenRef> }).champs,
        })),
        bornes,
        reglages.signature,
        codes,
        modeleSimule,
      );
    });
    assert.equal(propose.ok, true, propose.ok === false ? propose.refus.detail : "");
    if (!propose.ok) return;

    /* --- ③ R8 : la génération se journalise, AVEC son modèle et son rôle. */
    const runId = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.journaliserUneGeneration(db, {
        tenantId: orgA,
        modele: propose.provenance.modele,
        role: propose.provenance.role,
        statut: "ok",
        latenceMs: propose.provenance.latenceMs,
        tokensIn: propose.provenance.tokensIn,
        tokensOut: propose.provenance.tokensOut,
      }),
    );
    assert.ok(runId, "la génération n'a pas laissé de ligne : la dépense disparaît en silence");

    const journal = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{
        agent: string;
        model: string;
        cost: string;
        tokens_in: number;
        sovereign: boolean;
      }>(`select agent, model, cost, tokens_in, sovereign from public.agent_runs_v where id = $1`, [
        runId,
      ]);
      return rows[0];
    });
    assert.ok(journal, "la ligne de journal n'est pas lisible par celui qui l'a écrite");
    assert.equal(journal.agent, "fabrique.generateur");
    assert.equal(journal.model, MODELE_GENERATION);
    assert.ok(
      Number(journal.cost) > 0,
      `un coût nul pour ${String(journal.tokens_in)} jetons d'entrée : ` +
        "le tarif du couple (modèle, rôle) n'a pas été trouvé",
    );

    /* --- ④ La candidate, avec sa provenance. */
    const version = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.inscrireUneCandidate(db, {
        tenantId: orgA,
        libelle: `Facture A ${marque}`,
        signatureCle,
        portee: "organisation",
        definition: propose.recette,
        empreinte: propose.empreinte,
        provenance: { ...propose.provenance, agentRunId: runId },
        exemples: ids,
        motif: "proposée par le générateur à partir de deux exemples",
      }),
    );
    assert.equal(version.rang, 1);

    const etatNe = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.etatDUneVersion(db, version.versionId),
    );
    assert.equal(etatNe?.etat, "candidate");

    const provenanceLue = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ provenance: { generateur?: string; pieces?: string[] } }>(
        `select provenance from fabrique.recette_versions where id = $1`,
        [version.versionId],
      );
      return rows[0]!.provenance;
    });
    assert.equal(provenanceLue.generateur, "generateur/1");
    assert.equal(provenanceLue.pieces?.length, 2, "la provenance ne dit pas sur quoi on a appris");

    /* --- ⑤ Une validation humaine ne promeut pas. */
    const sansEvaluation = await sousIdentiteDuServeur(a.id, async (db) => {
      try {
        await fabrique.promouvoir(db, {
          tenantId: orgA,
          recetteVersionId: version.versionId,
          etat: "evaluee",
          motif: "les exemples étaient validés par un humain",
        });
        return null;
      } catch (e) {
        return codeDe(e);
      }
    });
    assert.equal(
      sansEvaluation,
      "23514",
      "une recette avance sans évaluation : une validation humaine a servi de preuve",
    );

    /* --- ⑥ L'évaluation, sur le jeu d'évaluation SEUL. */
    const mesure = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.evaluerUneVersion(db, orgA, version.versionId),
    );
    assert.equal(mesure.exemplesComptes, 2, "l'évaluation n'a pas vu ses deux exemples");
    assert.deepEqual(mesure.absentes, [], "une mesure manque, et on ne sait pas laquelle");
    assert.equal(mesure.mesures["exactitude_champs_critiques"], 1);
    assert.equal(mesure.mesures["taux_abstention"], 0);
    assert.equal(mesure.mesures["montants_faux_acceptes"], 0);
    assert.equal(mesure.reserve, null);

    /* --- ⑦ Observation, puis activation contre les seuils du référentiel. */
    await sousIdentiteDuServeur(a.id, async (db) => {
      for (const etat of ["evaluee", "observation", "active"] as const) {
        await fabrique.promouvoir(db, {
          tenantId: orgA,
          recetteVersionId: version.versionId,
          etat,
          evaluationId: mesure.evaluationId,
          motif: `avance vers ${etat}`,
        });
      }
    });
    const active = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.etatDUneVersion(db, version.versionId),
    );
    assert.equal(active?.etat, "active");

    /* --- ⑧ La dérive suspend, et rend la main au chemin existant. */
    const calme = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.surveillerUneVersion(db, orgA, version.versionId),
    );
    assert.equal(calme.derive, null, "une version sans exécution dérive déjà");
    assert.equal(calme.tauxAbstention, null, "un taux sur zéro exécution n'est pas un taux");

    await sousIdentiteDuServeur(a.id, async (db) => {
      await fabrique.inscrireExecution(db, {
        tenantId: orgA,
        recetteVersionId: version.versionId,
        pieceId: pieces.get("a"),
        issue: "designation",
        champsDesignes: 1,
        dureeMs: 12,
      });
      for (const nom of ["autres_valeurs", "six_lignes"]) {
        await fabrique.inscrireExecution(db, {
          tenantId: orgA,
          recetteVersionId: version.versionId,
          pieceId: pieces.get(nom),
          issue: "abstention",
          motif: "abstention — totals.base_ht:DESIGNATION_AMBIGUE",
        });
      }
    });

    const derive = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.surveillerUneVersion(db, orgA, version.versionId),
    );
    assert.equal(derive.executions, 3);
    assert.equal(derive.abstentions, 2);
    assert.equal(
      derive.derive,
      "signature_changee",
      "« DESIGNATION_AMBIGUE » dit qu'un format a changé, pas qu'une règle est trop étroite",
    );
    assert.equal(derive.suspendue, true);

    const apres = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.etatDUneVersion(db, version.versionId),
    );
    assert.equal(apres?.etat, "suspendue");

    const nePlusDesigner = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.contexteDeDesignation(db, orgA),
    );
    assert.deepEqual(
      nePlusDesigner.versions.map((v) => v.versionId),
      [],
      "une version suspendue est encore proposée à la reconnaissance : " +
        "le chemin existant n'a pas été rétabli",
    );

    /* --- ⑨ Rien n'est perdu : les pièces, les exécutions, l'historique. */
    const reste = await sousIdentiteDuServeur(a.id, async (db) => {
      const p = await db.query(`select id from capture.pieces where tenant_id = $1`, [orgA]);
      const x = await db.query(`select id from fabrique.executions where recette_version_id = $1`, [
        version.versionId,
      ]);
      const d = await db.query(
        `select nature::text as nature from fabrique.derives where recette_version_id = $1`,
        [version.versionId],
      );
      const h = await db.query(
        `select etat::text as etat from fabrique.promotions
          where recette_version_id = $1 order by ordre`,
        [version.versionId],
      );
      return {
        pieces: p.rows.length,
        executions: x.rows.length,
        derives: d.rows.map((r) => (r as { nature: string }).nature),
        historique: h.rows.map((r) => (r as { etat: string }).etat),
      };
    });
    assert.equal(reste.pieces, 4, "la suspension a emporté des documents");
    assert.equal(reste.executions, 3, "la suspension a emporté des exécutions");
    assert.deepEqual(reste.derives, ["signature_changee"]);
    assert.deepEqual(
      reste.historique,
      ["candidate", "evaluee", "observation", "active", "suspendue"],
      "l'historique n'est pas une suite de faits : quelque chose a été réécrit",
    );

    /* --- ⑩ Le retour arrière, puis le retrait. */
    await sousIdentiteDuServeur(a.id, async (db) => {
      await fabrique.promouvoir(db, {
        tenantId: orgA,
        recetteVersionId: version.versionId,
        etat: "observation",
        evaluationId: mesure.evaluationId,
        motif: "reprise après examen de la dérive",
      });
    });
    const reprise = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.etatDUneVersion(db, version.versionId),
    );
    assert.equal(reprise?.etat, "observation");

    const redesigne = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.contexteDeDesignation(db, orgA),
    );
    assert.deepEqual(
      redesigne.versions.map((v) => v.versionId),
      [version.versionId],
      "une version reprise en observation ne redésigne pas",
    );

    await sousIdentiteDuServeur(a.id, async (db) => {
      await fabrique.promouvoir(db, {
        tenantId: orgA,
        recetteVersionId: version.versionId,
        etat: "retiree",
        motif: "remplacée par une version nouvelle",
      });
    });
    const retiree = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.etatDUneVersion(db, version.versionId),
    );
    assert.equal(retiree?.etat, "retiree");

    const apresRetrait = await sousIdentiteDuServeur(a.id, async (db) => {
      try {
        await fabrique.promouvoir(db, {
          tenantId: orgA,
          recetteVersionId: version.versionId,
          etat: "active",
          evaluationId: mesure.evaluationId,
          motif: "on la remet en route",
        });
        return null;
      } catch (e) {
        return codeDe(e);
      }
    });
    assert.equal(apresRetrait, "23514", "une recette retirée revient en service");
  });

  it("une génération dont le couple (modèle, rôle) n'est pas tarifé LÈVE", async () => {
    /*
     * R8, sans échappatoire. `public.agents_run_log` lève quand il ne trouve
     * aucun tarif pour le couple ; si le dépôt rattrapait cette levée, la
     * dépense disparaîtrait en silence — et c'est arrivé quatre fois dans ce
     * dépôt, la première fois pendant dix jours.
     *
     * L'épreuve est écrite sur un rôle qui n'existe pas plutôt que sur le
     * vrai : elle vérifie que la porte est fermée, pas qu'elle grince.
     */
    const refus = await sousIdentiteDuServeur(a.id, async (db) => {
      try {
        await fabrique.journaliserUneGeneration(db, {
          tenantId: orgA,
          modele: MODELE_GENERATION,
          role: "role-sans-tarif",
          statut: "ok",
          latenceMs: 10,
          tokensIn: 100,
          tokensOut: 10,
        });
        return null;
      } catch (e) {
        return codeDe(e);
      }
    });
    assert.equal(
      refus,
      "23514",
      "une génération sans tarif se journalise quand même : le coût n'a plus d'origine",
    );
  });

  it("on ne suspend pas ce qui ne tourne pas, et la dérive reste inscrite", async () => {
    /*
     * Trouvé par mutation contre ce banc : remplacer le test d'état par
     * « toujours vrai » passait au vert. Une version `candidate` qui dérive
     * n'a pas à recevoir une transition que la base refuserait — la
     * surveillance planterait alors sur une erreur de cycle, au lieu de
     * rendre son constat. Le constat, lui, ne se perd pas : il s'inscrit.
     */
    const cle = `dormante-${marque}`;
    const vu = await sousIdentiteDuServeur(a.id, async (db) => {
      const exemple = await fabrique.qualifierUnExemple(db, {
        tenantId: orgA,
        pieceId: pieces.get("a"),
        signatureCle: cle,
        provenance: "import_expert",
        qualification: "designation_champ",
        usage: "apprentissage",
        attendu: { "totals.base_ht": ou(plans.get("a")!, "1180,000") },
      });
      const version = await fabrique.inscrireUneCandidate(db, {
        tenantId: orgA,
        libelle: `Dormante ${marque}`,
        signatureCle: cle,
        portee: "organisation",
        definition: RECETTE_HT,
        empreinte: "c".repeat(64),
        provenance: { generateur: "generateur/1" },
        exemples: [exemple.exempleId],
        motif: "pour éprouver la surveillance d'une version qui ne tourne pas",
      });
      await fabrique.inscrireExecution(db, {
        tenantId: orgA,
        recetteVersionId: version.versionId,
        pieceId: pieces.get("a"),
        issue: "abstention",
        motif: "abstention — totals.base_ht:TOKEN_NOT_FOUND",
      });
      const surveillance = await fabrique.surveillerUneVersion(db, orgA, version.versionId);
      const { rows } = await db.query(
        `select id from fabrique.derives where recette_version_id = $1`,
        [version.versionId],
      );
      const etat = await fabrique.etatDUneVersion(db, version.versionId);
      return { surveillance, derives: rows.length, etat: etat?.etat };
    });

    assert.equal(vu.surveillance.derive, "abstention_en_hausse");
    assert.equal(vu.surveillance.suspendue, false, "une candidate a été « suspendue »");
    assert.equal(vu.derives, 1, "la dérive d'une version qui ne tourne pas n'est pas inscrite");
    assert.equal(vu.etat, "candidate");
  });

  /* ================================= LES DONNÉES D'ÉVALUATION MANQUANTES = */

  it("sans données d'évaluation, la recette reste en observation avec sa raison", async () => {
    /*
     * La tentation serait de compléter avec les exemples d'apprentissage
     * « parce qu'il y en a peu ». Une recette mesurée sur ce qui l'a produite
     * rend 1,00, et ce 1,00 franchit tous les seuils. La base l'interdit par
     * clé étrangère ; l'application ne le tente même pas, et l'évaluation
     * s'écrit SANS la mesure qu'elle n'a pas pu calculer.
     */
    const cle = `orphelin-${marque}`;
    const sortie = await sousIdentiteDuServeur(a.id, async (db) => {
      const exemple = await fabrique.qualifierUnExemple(db, {
        tenantId: orgA,
        pieceId: pieces.get("a"),
        signatureCle: cle,
        provenance: "import_expert",
        qualification: "designation_champ",
        usage: "apprentissage",
        attendu: { "totals.base_ht": ou(plans.get("a")!, "1180,000") },
      });
      const version = await fabrique.inscrireUneCandidate(db, {
        tenantId: orgA,
        libelle: `Sans évaluation ${marque}`,
        signatureCle: cle,
        portee: "organisation",
        definition: RECETTE_HT,
        empreinte: "b".repeat(64),
        provenance: { generateur: "generateur/1" },
        exemples: [exemple.exempleId],
        motif: "pour éprouver l'absence de jeu d'évaluation",
      });
      const mesure = await fabrique.evaluerUneVersion(db, orgA, version.versionId);
      return { version, mesure };
    });

    assert.equal(sortie.mesure.exemplesComptes, 0);
    assert.deepEqual(sortie.mesure.mesures, {}, "une mesure a été produite sur zéro observation");
    assert.ok(
      sortie.mesure.reserve?.includes("insuffisantes"),
      "la réserve ne dit pas que les données manquent",
    );
    assert.equal(
      sortie.mesure.absentes.length,
      3,
      "les trois mesures devraient être absentes, et nommées une par une",
    );

    /* L'observation, elle, reste possible : c'est le sens même du mot. */
    await sousIdentiteDuServeur(a.id, async (db) => {
      for (const etat of ["evaluee", "observation"] as const) {
        await fabrique.promouvoir(db, {
          tenantId: orgA,
          recetteVersionId: sortie.version.versionId,
          etat,
          evaluationId: sortie.mesure.evaluationId,
          motif: "on l'observe, on ne la croit pas",
        });
      }
    });

    const refus = await sousIdentiteDuServeur(a.id, async (db) => {
      try {
        await fabrique.promouvoir(db, {
          tenantId: orgA,
          recetteVersionId: sortie.version.versionId,
          etat: "active",
          evaluationId: sortie.mesure.evaluationId,
          motif: "malgré tout",
        });
        return "";
      } catch (e) {
        return (e as { message?: string }).message ?? String(e);
      }
    });
    assert.match(
      refus,
      /manque a l'evaluation/,
      `l'activation est passée sans mesure, ou pour une autre raison : « ${refus} »`,
    );

    const etat = await sousIdentiteDuServeur(a.id, async (db) =>
      fabrique.etatDUneVersion(db, sortie.version.versionId),
    );
    assert.equal(etat?.etat, "observation");
  });

  /* ============ UNE DÉCISION COMPTABLE NE DEVIENT PAS UNE RÈGLE DE LECTURE */

  it("une décision comptable ne rejoint pas l'apprentissage d'une recette", async () => {
    /*
     * Le socle le tient par une colonne calculée et une clé étrangère, et le
     * prouve déjà. Ce qui s'éprouve ICI, c'est que le chemin applicatif ne
     * l'oublie pas : `exemplesDApprentissage` filtre sur
     * `nourrit_une_recette`, donc un exemple qualifié « décision comptable »
     * n'arrive jamais jusqu'au générateur, et ne peut pas lui apprendre la
     * forme du papier.
     */
    const cle = `comptable-${marque}`;
    const vus = await sousIdentiteDuServeur(a.id, async (db) => {
      await fabrique.qualifierUnExemple(db, {
        tenantId: orgA,
        pieceId: pieces.get("a"),
        signatureCle: cle,
        provenance: "correction_humaine",
        qualification: "decision_comptable",
        usage: "apprentissage",
        attendu: { "totals.base_ht": ou(plans.get("a")!, "1180,000") },
      });
      return fabrique.exemplesDApprentissage(db, orgA, cle);
    });
    assert.deepEqual(
      vus,
      [],
      "une décision comptable est arrivée jusqu'au générateur : elle deviendrait " +
        "une règle de lecture",
    );
  });
});
