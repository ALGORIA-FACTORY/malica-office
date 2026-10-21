/**
 * Le socle de la fabrique de lecteurs, éprouvé — pas relu.
 *
 * Tout ce qui suit passe par `sousIdentiteDuServeur`, donc par le rôle `authenticated`
 * avec le claim `sub` posé dans la transaction, exactement comme une requête
 * réelle. C'est la quatrième règle du plan
 * (`docs/fabrique-de-lecteurs/00-plan.md`) : une preuve obtenue en
 * superutilisateur ne prouve rien, parce qu'un superutilisateur n'est arrêté
 * par aucune politique. Les sept désaccords du 17 octobre viennent tous de là.
 *
 * Quatre garanties, indépendantes les unes des autres :
 *
 *   R6  — une organisation ne lit ni n'écrit chez une autre ;
 *   R7  — une décision, une évaluation, une exécution sont des faits : une
 *         suspension est une écriture nouvelle, jamais un `update` ;
 *   le plan — une décision comptable n'est pas une règle de lecture, et la
 *         frontière est une contrainte de base, pas une convention ;
 *   R10 — les seuils de promotion viennent du référentiel, datés et
 *         surchargeables, et leur absence REFUSE au lieu de deviner.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/socle-de-donnees.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur, type Requete } from "../db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Le SQLSTATE d'une erreur `pg`, ou son message si elle n'en porte pas. */
function codeDe(erreur: unknown): string {
  const e = erreur as { code?: string; message?: string };
  return e.code ?? e.message ?? String(erreur);
}

/** Joue une requête et rend le SQLSTATE du refus — ou `null` si elle a passé. */
async function refusDe(
  utilisateur: string,
  sql: string,
  args: unknown[] = [],
): Promise<string | null> {
  try {
    await sousIdentiteDuServeur(utilisateur, async (db) => db.query(sql, args));
    return null;
  } catch (erreur) {
    return codeDe(erreur);
  }
}

/**
 * Le MESSAGE du refus, et pas seulement son code.
 *
 * Écrit après une fausse victoire : « une recette sous les seuils devient
 * active » passait au vert alors qu'aucun seuil n'était en vigueur — la
 * migration les datait du 20 octobre, et `current_date` était le 18. Le refus
 * avait le bon code pour la mauvaise raison. Un code ne dit pas pourquoi.
 */
async function motifDuRefus(
  utilisateur: string,
  sql: string,
  args: unknown[] = [],
): Promise<string> {
  try {
    await sousIdentiteDuServeur(utilisateur, async (db) => db.query(sql, args));
    return "";
  } catch (erreur) {
    return (erreur as { message?: string }).message ?? String(erreur);
  }
}

describe("le socle de la fabrique de lecteurs", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `fab-${Date.now()}`;
  let a: Utilisateur;
  let b: Utilisateur;
  let orgA = "";
  let orgB = "";
  let pieceA = "";
  let recetteA = "";
  let versionA = "";

  /** Monte une organisation et une pièce sous l'identité donnée, par le vrai chemin. */
  async function monter(u: Utilisateur, suffixe: string): Promise<[string, string]> {
    return sousIdentiteDuServeur(u.id, async (db: Requete) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `ESSAI ${marque} ${suffixe}`, "autonome", "TN", "TND"],
      );
      const org = rows[0]!.org;
      const piece = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'partage', $2, $3) returning id`,
        [org, `essai/${marque}-${suffixe}.pdf`, `${marque}-${suffixe}`],
      );
      return [org, piece.rows[0]!.id];
    });
  }

  /** Une recette neuve avec sa première version, chez A. */
  async function recetteNeuve(cle: string, empreinte: string): Promise<[string, string]> {
    return sousIdentiteDuServeur(a.id, async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, $2, $3, 'organisation') returning id`,
        [orgA, cle, `${cle}-${marque}`],
      );
      const v = await db.query<{ id: string }>(
        `insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte)
         values ($1, $2, 1, $3, $4) returning id`,
        [orgA, r.rows[0]!.id, JSON.stringify({ version: 1, champs: [] }), empreinte.repeat(64)],
      );
      return [r.rows[0]!.id, v.rows[0]!.id];
    });
  }

  before(async () => {
    const ca = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const cb = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(ca && cb, "les deux comptes doivent être créés");
    a = ca;
    b = cb;
    [orgA, pieceA] = await monter(a, "A");
    [orgB] = await monter(b, "B");
    [recetteA, versionA] = await recetteNeuve("socle", "0");
  });

  after(async () => {
    // On archive, on ne supprime pas : R7 tient `audit.event_log`, et une
    // suppression d'organisation y cascade puis échoue, laissant tout derrière.
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (BASE_CONFIGUREE && admin && orgA) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = any($1) and archived_at is null`,
          [[orgA, orgB]],
        );
      } finally {
        await pool.end();
      }
    }
    await fermerLePool();
  });

  /* ------------------------------------------------------------------- R6 */

  it("une organisation ne lit pas les recettes d'une autre", async () => {
    const vues = await sousIdentiteDuServeur(b.id, async (db) => {
      const { rows } = await db.query(`select id from fabrique.recettes`);
      return rows;
    });
    assert.deepEqual(vues, [], "B lit une recette de A : la RLS de fabrique.recettes ne tient pas");

    const siennes = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(`select id from fabrique.recettes`);
      return rows.map((r) => r.id);
    });
    assert.deepEqual(siennes, [recetteA], "A ne lit plus sa propre recette");
  });

  it("une organisation n'inscrit pas une recette chez une autre", async () => {
    const refus = await refusDe(
      b.id,
      `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
       values ($1, 'intrusion', $2, 'organisation')`,
      [orgA, `intrus-${marque}`],
    );
    assert.equal(refus, "42501", "B écrit une recette dans le tenant de A");
  });

  it("une organisation ne lit pas les exemples ni les exécutions d'une autre", async () => {
    await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into fabrique.exemples
           (tenant_id, piece_id, signature_cle, provenance, qualification, usage, attendu)
         values ($1, $2, $3, 'correction_humaine', 'designation_champ', 'apprentissage', '{}'::jsonb)`,
        [orgA, pieceA, `sig-${marque}`],
      );
      await db.query(
        `insert into fabrique.executions (tenant_id, recette_version_id, piece_id, issue)
         values ($1, $2, $3, 'designation')`,
        [orgA, versionA, pieceA],
      );
    });

    const vues = await sousIdentiteDuServeur(b.id, async (db) => {
      const e = await db.query(`select id from fabrique.exemples`);
      const x = await db.query(`select id from fabrique.executions`);
      return [e.rows.length, x.rows.length];
    });
    assert.deepEqual(vues, [0, 0], "B lit les exemples ou les exécutions de A");
  });

  it("une exécution ne se rattache pas à la pièce d'une autre organisation", async () => {
    const [, versionB] = await sousIdentiteDuServeur(b.id, async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, 'chez B', $2, 'organisation') returning id`,
        [orgB, `b-${marque}`],
      );
      const v = await db.query<{ id: string }>(
        `insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte)
         values ($1, $2, 1, $3, $4) returning id`,
        [orgB, r.rows[0]!.id, JSON.stringify({ version: 1, champs: [] }), "b".repeat(64)],
      );
      return [r.rows[0]!.id, v.rows[0]!.id];
    });

    // La clé étrangère ne regarde pas la RLS : sans garde, B rattacherait son
    // exécution à la pièce de A et en apprendrait l'existence.
    const refus = await refusDe(
      b.id,
      `insert into fabrique.executions (tenant_id, recette_version_id, piece_id, issue)
       values ($1, $2, $3, 'designation')`,
      [orgB, versionB, pieceA],
    );
    assert.equal(refus, "42501", "B rattache une exécution à la pièce de A");
  });

  it("une recette ne naît pas partagée par omission", async () => {
    // La frontière d'une future mutualisation existe (`portee`), mais elle n'a
    // AUCUN défaut : un partage qu'on n'a pas décidé ne peut pas naître d'une
    // colonne qu'on a oublié de remplir.
    const refus = await refusDe(
      a.id,
      `insert into fabrique.recettes (tenant_id, libelle, signature_cle)
       values ($1, 'sans portée', $2)`,
      [orgA, `sans-portee-${marque}`],
    );
    assert.equal(
      refus,
      "23502",
      "une recette sans portée est acceptée : le partage peut naître d'un oubli",
    );
  });

  it("une recette mutualisée ne se lit toujours pas d'une autre organisation", async () => {
    // La colonne existe ; le partage, lui, n'est PAS activé. Le jour où il le
    // sera, ce sera par une politique écrite, pas par une valeur posée.
    await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, 'future mutualisée', $2, 'mutualisee')`,
        [orgA, `mutu-${marque}`],
      );
    });
    const vues = await sousIdentiteDuServeur(b.id, async (db) => {
      const { rows } = await db.query(
        `select id from fabrique.recettes where portee = 'mutualisee'`,
      );
      return rows.length;
    });
    assert.equal(
      vues,
      0,
      "une recette marquée mutualisée est déjà lisible : le partage s'est activé tout seul",
    );
  });

  /* ------------------------------------------------------------------- R7 */

  it("un fait de la fabrique ne se réécrit pas", async () => {
    await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'candidate', 'première inscription')`,
        [orgA, versionA],
      );
      // Une table vide ne prouve rien d'un déclencheur : chacune porte une ligne.
      await db.query(
        `insert into fabrique.evaluations (tenant_id, recette_version_id, mesures, exemples_comptes)
         values ($1, $2, '{}'::jsonb, 0)`,
        [orgA, versionA],
      );
      await db.query(
        `insert into fabrique.derives (tenant_id, recette_version_id, piece_id, nature, mesure)
         values ($1, $2, $3, 'abstention_en_hausse', '{}'::jsonb)`,
        [orgA, versionA, pieceA],
      );
    });

    /*
     * R7 tient par DEUX choses, et c'est l'épreuve qui l'a appris.
     *
     * J'attendais le déclencheur `deny_mutation` sous l'identité réelle. Il ne
     * se déclenche jamais : une table en ajout seul n'a AUCUNE politique
     * `update`, donc aucune ligne n'est candidate, donc `update` touche zéro
     * ligne — en silence, sans erreur. La première couche est un refus muet.
     *
     * Le déclencheur, lui, garde l'autre chemin : le propriétaire des tables
     * et toute fonction `security definer` qui lui appartient, que `force row
     * level security` n'arrête pas. C'est le seul endroit de ce fichier où
     * l'on emprunte la connexion d'administration, et c'est justifié : ce
     * qu'on y éprouve N'EXISTE que pour ce chemin-là.
     */
    const mutations: [string, string][] = [
      ["fabrique.promotions", `update fabrique.promotions set motif = 'reecrit'`],
      ["fabrique.executions", `update fabrique.executions set issue = 'abstention'`],
      ["fabrique.exemples", `update fabrique.exemples set qualification = 'normalisation'`],
      ["fabrique.recette_versions", `update fabrique.recette_versions set rang = 2`],
      ["fabrique.recettes", `update fabrique.recettes set libelle = 'autre'`],
      ["fabrique.evaluations", `update fabrique.evaluations set exemples_comptes = 99`],
      ["fabrique.derives", `update fabrique.derives set nature = 'correction_humaine'`],
    ];

    for (const [table, mutation] of mutations) {
      const touchees = await sousIdentiteDuServeur(a.id, async (db) => {
        const r = await db.query(mutation);
        const d = await db.query(mutation.replace(/^update (\S+) set .*/, "delete from $1"));
        return (r.rowCount ?? 0) + (d.rowCount ?? 0);
      });
      assert.equal(touchees, 0, `${table} laisse « authenticated » réécrire ou effacer un fait`);
    }

    const motifIntact = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ motif: string }>(
        `select motif from fabrique.promotions where recette_version_id = $1 order by ordre`,
        [versionA],
      );
      return rows[0]?.motif;
    });
    assert.equal(motifIntact, "première inscription", "le motif a bougé malgré le refus muet");

    const admin = process.env["DATABASE_URL_ADMIN"];
    assert.ok(admin, "DATABASE_URL_ADMIN absente : le second chemin de R7 n'est pas éprouvé");
    const pool = new pg.Pool({ connectionString: admin });
    try {
      for (const [table, mutation] of mutations) {
        let code: string | null = null;
        try {
          await pool.query(mutation);
        } catch (erreur) {
          code = codeDe(erreur);
        }
        assert.equal(code, "23001", `${table} accepte un update du propriétaire : R7 ne tient pas`);
      }
    } finally {
      await pool.end();
    }

    /*
     * Et toutes les tables de `fabrique`, y compris celles qu'on vient
     * d'éprouver à vide, portent bien un garde R7. Reconnues au schéma, pas à
     * une liste : une table ajoutée demain sans garde fait rougir ici.
     *
     * Il y a DEUX gardes, et les deux refusent la réécriture — c'est le seul
     * point commun qui compte ici :
     *
     *   `app.deny_mutation()` — le strict. Il refuse tout, toujours.
     *   `app.deny_mutation_hors_effacement_de_travail()` — le permissif de la
     *      fabrique. Il refuse tout aussi, sauf la cascade d'un travail dont
     *      la pièce s'efface sous `capture_piece_supprimer`, qui a vérifié que
     *      la pièce n'est engagée nulle part. `fabrique.travaux` porte le
     *      permissif de `capture`, qui lit son `piece_id` directement.
     *
     * Sans eux, une photo ratée lue par erreur restait à vie dans le coffre :
     * le défaut que `20261020160000` et `20261020200000` corrigent, et que le
     * 18 octobre avait déjà corrigé pour trois tables de `capture`.
     *
     * La liste est CLOSE, et c'est ce qui fait tenir l'épreuve : une table sans
     * aucun déclencheur, ou qui n'en porte qu'un sans rapport, rougit toujours.
     * Ce que ces deux gardes ouvrent est éprouvé ailleurs, et étroitement :
     * `schema.test.ts (d bis)` interdit toute politique et tout droit
     * DELETE/UPDATE sur les tables du garde permissif — sans quoi
     * `malica.piece_effacable`, qu'un utilisateur quelconque peut poser,
     * deviendrait une clé.
     */
    const nues = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ table_: string }>(
        `select c.relname as table_
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'fabrique'
          where c.relkind = 'r'
            and not exists (
              select 1 from pg_trigger t
               where t.tgrelid = c.oid and not t.tgisinternal
                 and t.tgfoid in (
                   'app.deny_mutation()'::regprocedure,
                   'app.deny_mutation_hors_effacement_de_piece()'::regprocedure,
                   'app.deny_mutation_hors_effacement_de_travail()'::regprocedure))
          order by 1`,
      );
      return rows.map((r) => r.table_);
    });
    assert.deepEqual(nues, [], "ces tables de la fabrique ne refusent pas la réécriture");
  });

  it("une suspension est une écriture nouvelle, et l'état se lit au dernier fait", async () => {
    const etat = await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'retiree', 'retrait de la version d''essai')`,
        [orgA, versionA],
      );
      const { rows } = await db.query<{ etat: string }>(
        `select etat from fabrique.etat_des_recettes_v where recette_version_id = $1`,
        [versionA],
      );
      return rows[0]?.etat;
    });
    assert.equal(etat, "retiree");
  });

  /* -------------------------------- LA FRONTIÈRE QUI PORTE TOUT LE MODÈLE */

  it("une décision comptable ne nourrit aucune recette", async () => {
    const exemple = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into fabrique.exemples
           (tenant_id, piece_id, signature_cle, provenance, qualification, usage, attendu)
         values ($1, $2, $3, 'correction_humaine', 'decision_comptable', 'apprentissage', '{}'::jsonb)
         returning id`,
        [orgA, pieceA, `sig-${marque}`],
      );
      return rows[0]!.id;
    });

    const refus = await refusDe(
      a.id,
      `insert into fabrique.recette_version_exemples
         (tenant_id, recette_version_id, exemple_id, nourrit_une_recette, usage)
       values ($1, $2, $3, true, 'apprentissage')`,
      [orgA, versionA, exemple],
    );
    assert.equal(
      refus,
      "23503",
      `un exemple qualifié « décision comptable » est entré dans une recette (refus : ${refus})`,
    );

    // Et on ne contourne pas en recopiant « false » : le `check` tient la colonne.
    const menteur = await refusDe(
      a.id,
      `insert into fabrique.recette_version_exemples
         (tenant_id, recette_version_id, exemple_id, nourrit_une_recette, usage)
       values ($1, $2, $3, false, 'apprentissage')`,
      [orgA, versionA, exemple],
    );
    assert.equal(
      menteur,
      "23514",
      "la colonne recopiée n'est pas contrainte : la frontière redevient une convention",
    );
  });

  it("une correction de lecture, elle, nourrit une recette", async () => {
    const exemple = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into fabrique.exemples
           (tenant_id, piece_id, signature_cle, provenance, qualification, usage, attendu)
         values ($1, $2, $3, 'correction_humaine', 'reconnaissance_ocr', 'apprentissage', '{}'::jsonb)
         returning id`,
        [orgA, pieceA, `sig-${marque}`],
      );
      return rows[0]!.id;
    });
    const passe = await refusDe(
      a.id,
      `insert into fabrique.recette_version_exemples
         (tenant_id, recette_version_id, exemple_id, nourrit_une_recette, usage)
       values ($1, $2, $3, true, 'apprentissage')`,
      [orgA, versionA, exemple],
    );
    assert.equal(passe, null, "une correction de reconnaissance est refusée comme source");
  });

  it("l'apprentissage et l'évaluation ne se mélangent pas", async () => {
    const [apprentissage, evalue] = await sousIdentiteDuServeur(a.id, async (db) => {
      const ins = async (usage: string) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into fabrique.exemples
             (tenant_id, piece_id, signature_cle, provenance, qualification, usage, attendu)
           values ($1, $2, $3, 'validation_humaine', 'designation_champ', $4, '{}'::jsonb)
           returning id`,
          [orgA, pieceA, `sig-${marque}`, usage],
        );
        return rows[0]!.id;
      };
      return [await ins("apprentissage"), await ins("evaluation")];
    });

    const evaluationId = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into fabrique.evaluations
           (tenant_id, recette_version_id, mesures, exemples_comptes)
         values ($1, $2, '{}'::jsonb, 1) returning id`,
        [orgA, versionA],
      );
      return rows[0]!.id;
    });

    const refus = await refusDe(
      a.id,
      `insert into fabrique.evaluation_exemples (tenant_id, evaluation_id, exemple_id, usage)
       values ($1, $2, $3, 'apprentissage')`,
      [orgA, evaluationId, apprentissage],
    );
    assert.equal(refus, "23514", "un exemple d'apprentissage entre dans une évaluation");

    const passe = await refusDe(
      a.id,
      `insert into fabrique.evaluation_exemples (tenant_id, evaluation_id, exemple_id, usage)
       values ($1, $2, $3, 'evaluation')`,
      [orgA, evaluationId, evalue],
    );
    assert.equal(passe, null, "un exemple d'évaluation est refusé de son propre jeu");
  });

  it("une validation humaine fournit un exemple, elle n'autorise aucune promotion", async () => {
    // Deux faits distincts. Une promotion exige une ÉVALUATION ; aucun exemple,
    // fût-il validé par un expert, ne tient lieu de preuve de qualité.
    const [, version] = await recetteNeuve("validation", "3");
    await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into fabrique.exemples
           (tenant_id, piece_id, signature_cle, provenance, qualification, usage, attendu)
         values ($1, $2, $3, 'validation_humaine', 'designation_champ', 'evaluation', '{}'::jsonb)`,
        [orgA, pieceA, `sig-${marque}`],
      );
      await db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'candidate', 'née')`,
        [orgA, version],
      );
    });
    const refus = await refusDe(
      a.id,
      `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
       values ($1, $2, 'evaluee', 'validée par l''expert')`,
      [orgA, version],
    );
    assert.equal(
      refus,
      "23514",
      "une recette avance sans évaluation : une validation humaine a servi de promotion",
    );
  });

  /* -------------------------------------------------- R10 — LES SEUILS */

  it("une recette ne devient active qu'en franchissant les seuils du référentiel", async () => {
    const [, version] = await recetteNeuve("cycle", "1");

    // Le cycle ne se saute pas : candidate -> évaluée -> observation -> active.
    const saut = await refusDe(
      a.id,
      `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
       values ($1, $2, 'active', 'tout de suite')`,
      [orgA, version],
    );
    assert.equal(saut, "23514", "une recette devient active sans passer par l'observation");

    const insuffisante = await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'candidate', 'née')`,
        [orgA, version],
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into fabrique.evaluations (tenant_id, recette_version_id, mesures, exemples_comptes)
         values ($1, $2, $3, 40) returning id`,
        [
          orgA,
          version,
          JSON.stringify({
            exactitude_champs_critiques: 0.5,
            montants_faux_acceptes: 3,
            taux_abstention: 0.9,
          }),
        ],
      );
      return rows[0]!.id;
    });

    for (const etat of ["evaluee", "observation"]) {
      const r = await refusDe(
        a.id,
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
         values ($1, $2, $3, $4, 'avance')`,
        [orgA, version, etat, insuffisante],
      );
      assert.equal(r, null, `le passage à « ${etat} » est refusé alors qu'aucun seuil ne le borne`);
    }

    const sousLeSeuil = await motifDuRefus(
      a.id,
      `insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
       values ($1, $2, 'active', $3, 'malgré tout')`,
      [orgA, version, insuffisante],
    );
    assert.match(
      sousLeSeuil,
      /^seuil exactitude_champs_critiques/,
      `le refus ne nomme pas le seuil franchi — donc il ne vient peut-être pas de lui : « ${sousLeSeuil} »`,
    );

    const bonne = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into fabrique.evaluations (tenant_id, recette_version_id, mesures, exemples_comptes)
         values ($1, $2, $3, 40) returning id`,
        [
          orgA,
          version,
          JSON.stringify({
            exactitude_champs_critiques: 0.995,
            montants_faux_acceptes: 0,
            taux_abstention: 0.1,
          }),
        ],
      );
      return rows[0]!.id;
    });

    const activee = await refusDe(
      a.id,
      `insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
       values ($1, $2, 'active', $3, 'seuils franchis')`,
      [orgA, version, bonne],
    );
    assert.equal(activee, null, "une recette qui franchit tous les seuils reste refusée");

    // Et le retour arrière existe : suspendre, puis reprendre l'observation.
    const suspension = await refusDe(
      a.id,
      `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
       values ($1, $2, 'suspendue', 'dérive constatée')`,
      [orgA, version],
    );
    assert.equal(suspension, null, "une recette active ne peut pas être suspendue");

    const reprise = await refusDe(
      a.id,
      `insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
       values ($1, $2, 'observation', $3, 'remise en observation')`,
      [orgA, version, bonne],
    );
    assert.equal(reprise, null, "une recette suspendue ne revient pas en observation");
  });

  it("une évaluation sans la mesure attendue n'active rien", async () => {
    const [, version] = await recetteNeuve("mesure-absente", "2");
    const evaluation = await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'candidate', 'née')`,
        [orgA, version],
      );
      const e = await db.query<{ id: string }>(
        `insert into fabrique.evaluations (tenant_id, recette_version_id, mesures, exemples_comptes)
         values ($1, $2, '{}'::jsonb, 40) returning id`,
        [orgA, version],
      );
      const id = e.rows[0]!.id;
      for (const etat of ["evaluee", "observation"]) {
        await db.query(
          `insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
           values ($1, $2, $3, $4, 'avance')`,
          [orgA, version, etat, id],
        );
      }
      return id;
    });

    const refus = await refusDe(
      a.id,
      `insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
       values ($1, $2, 'active', $3, 'sur une mesure absente')`,
      [orgA, version, evaluation],
    );
    assert.equal(
      refus,
      "23514",
      "une mesure absente vaut acquiescement : c'est le repli implicite que R4 interdit",
    );
  });

  it("un cabinet arrête son propre seuil, au-dessus du défaut livré", async () => {
    const livres = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ mesure: string; sens: string; exigence: string }>(
        `select mesure, sens, exigence from fabrique.seuils_exiges($1) order by mesure`,
        [orgA],
      );
      return rows;
    });
    assert.ok(livres.length > 0, "aucun seuil livré : le référentiel ne porte rien");

    const premier = livres[0]!;
    const apres = await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, $2, 0.123456, 'arrêté par le cabinet')`,
        [orgA, `fabrique.seuil.promotion.${premier.sens}.${premier.mesure}`],
      );
      const { rows } = await db.query<{ exigence: string }>(
        `select exigence from fabrique.seuils_exiges($1) where mesure = $2`,
        [orgA, premier.mesure],
      );
      return rows[0]!.exigence;
    });
    assert.equal(
      Number(apres),
      0.123456,
      "la surcharge du cabinet ne l'emporte pas sur le défaut du pack",
    );

    const chezB = await sousIdentiteDuServeur(b.id, async (db) => {
      const { rows } = await db.query<{ exigence: string }>(
        `select exigence from fabrique.seuils_exiges($1) where mesure = $2`,
        [orgB, premier.mesure],
      );
      return rows[0]!.exigence;
    });
    assert.equal(Number(chezB), Number(premier.exigence), "la décision de A s'applique chez B");
  });

  it("les cinq bornes du validateur sortent du référentiel, toutes ensemble", async () => {
    // Le validateur de recette les exige sans défaut : « tant qu'elles n'y
    // sont pas, il ne s'appelle pas plutôt que de s'appeler faux ». Si la base
    // n'en rendait que quatre, la cinquième serait inventée par quelqu'un.
    const bornes = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{
        borne: string;
        valeur: string;
        arrete_par_le_cabinet: boolean;
      }>(`select * from fabrique.bornes_de_recette($1) order by borne`, [orgA]);
      return rows;
    });

    assert.deepEqual(
      bornes.map((b) => [b.borne, Number(b.valeur), b.arrete_par_le_cabinet]),
      [
        // Le défaut livré est passé de 3 à 2 le 19 octobre 2026, après mesure :
        // à 3, la borne refusait quatre ancres qui ne désignent qu'un jeton et
        // aucune des deux qui en désignent plusieurs (migration
        // 20261020200000, et le relevé dans `fabrique/interprete.test.ts`).
        ["ancre_texte_min", 2, false],
        ["champs_max", 50, false],
        ["jetons_max", 12, false],
        ["rang_max", 50, false],
        ["selecteurs_max", 200, false],
      ],
      "les bornes livrées ne sont pas celles du référentiel",
    );

    const surchargee = await sousIdentiteDuServeur(a.id, async (db) => {
      await db.query(
        `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, 'fabrique.seuil.recette.ancre_texte_min', 1, 'factures arabes : mentions d''une lettre')`,
        [orgA],
      );
      const { rows } = await db.query<{ valeur: string; arrete_par_le_cabinet: boolean }>(
        `select valeur, arrete_par_le_cabinet from fabrique.bornes_de_recette($1)
          where borne = 'ancre_texte_min'`,
        [orgA],
      );
      return rows[0]!;
    });
    /*
     * Un caractère : « ت » pour la date sur une facture arabe. Le défaut livré
     * le refuse, et c'est délibéré — un caractère seul est un symbole, pas une
     * étiquette. Un cabinet qui lit ce format l'abaisse, sans déploiement.
     */
    assert.equal(Number(surchargee.valeur), 1, "le cabinet ne peut pas abaisser la borne d'ancre");
    assert.equal(
      surchargee.arrete_par_le_cabinet,
      true,
      "rien ne distingue ce que le cabinet a arrêté du défaut livré (R10, conséquence 2)",
    );

    // Les seuils de promotion et les bornes de recette ne se mélangent pas :
    // une borne n'est pas une mesure d'évaluation.
    const mesures = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ mesure: string }>(
        `select mesure from fabrique.seuils_exiges($1)`,
        [orgA],
      );
      return rows.map((r) => r.mesure).sort();
    });
    assert.deepEqual(
      mesures,
      ["exactitude_champs_critiques", "montants_faux_acceptes", "taux_abstention"],
      "une borne de validateur est comptée comme un seuil de promotion",
    );
  });

  it("une recette ne porte aucun montant, et le stockage le refuse aussi", async () => {
    /*
     * R2, et la règle ① du plan. Le contrat de recette rend la production
     * d'une valeur impossible par le TYPE — `{ designe } | { abstention } |
     * { absent }` n'a aucun champ où écrire un montant. Restait le stockage :
     * un `jsonb` accepte toutes les clés, y compris celles que le type
     * interdit. C'est la dernière porte, et elle se ferme ici.
     */
    const [recette] = await sousIdentiteDuServeur(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, 'porteuse de valeur', $2, 'organisation') returning id`,
        [orgA, `valeur-${marque}`],
      );
      return [rows[0]!.id];
    });

    for (const clef of ["valeur", "value", "montant", "amount"]) {
      const refus = await refusDe(
        a.id,
        `insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte)
         values ($1, $2, 1, $3, $4)`,
        [
          orgA,
          recette,
          JSON.stringify({ version: 1, champs: [{ nom: "total_ttc", [clef]: "5 650,000" }] }),
          "9".repeat(64),
        ],
      );
      assert.equal(
        refus,
        "23514",
        `une recette peut porter « ${clef} » : c'est le chemin par lequel 5 650 000 D est devenu 650 000 D, rendu permanent`,
      );
    }

    const saine = await refusDe(
      a.id,
      `insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte)
       values ($1, $2, 1, $3, $4)`,
      [
        orgA,
        recette,
        JSON.stringify({
          version: 1,
          champs: [{ nom: "total_ttc", ancre: "Total TTC", selecteur: "a_droite_de" }],
        }),
        "8".repeat(64),
      ],
    );
    assert.equal(saine, null, "une recette qui ne désigne que des ancres est refusée");
  });
});
