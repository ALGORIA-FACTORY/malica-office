/**
 * La fabrique de lecteurs, côté dépôt — strictement ce que le BRANCHEMENT lit.
 *
 * ================================================================= POURQUOI
 *
 * `malica/lecture/par-recette.ts` est le point d'insertion entre le plan de
 * jetons et la désignation. Il ne parle à la base que par l'interface `rpc`
 * de `AppelApi` — comme tout le reste de la chaîne de lecture, qui s'exécute
 * HORS transaction parce qu'un appel de modèle dure des minutes.
 *
 * Ce dépôt est la frontière de cet usage, et depuis le 20 octobre 2026 de
 * celui du CYCLE DE VIE : qualifier un exemple, proposer une recette à partir
 * de plusieurs exemples, l'évaluer, la promouvoir, la surveiller, la
 * suspendre. Les écrans (tâche 9) et les droits fins (tâche 8) s'ajouteront
 * par-dessus ; rien ici n'est deviné d'avance.
 *
 * ========================================================== CE QU'IL NE FAIT PAS
 *
 * Il ne décide rien. Les treize réglages et les cinq bornes viennent de
 * `fabrique.reglages_de_signature` et `fabrique.bornes_de_recette`, qui LÈVENT
 * si l'une manque (R4, R10) ; l'état d'une version vient de
 * `fabrique.etat_des_recettes_v`, qui est le DERNIER fait inscrit. Aucun
 * seuil, aucun état, aucun nom de format n'est écrit dans ce fichier.
 */
import { z } from "zod";

import type { Requete } from "../db.ts";
import {
  etatCourant,
  evaluerUneVersion,
  inscrireUneCandidate,
  promouvoir,
  qualifierUnExemple,
  surveiller,
  type EtatDeRecette,
} from "../fabrique/cycle.ts";
import { lireLesBornesDeRecette, lireLesReglages } from "../fabrique/interprete-reglages.ts";
import { enregistrerTravail, etatDuTravail } from "../fabrique/travaux.ts";
import type { PageToken } from "../malica/lecture/token-plan.ts";

/**
 * Les états sous lesquels une version DÉSIGNE pour de bon.
 *
 * Ce ne sont pas des seuils — ce sont les deux états du cycle de vie
 * (`fabrique.etat_t`) où la recette s'exécute : `observation`, parce que
 * « toute recette naît en observation : elle s'exécute, on compare, on ne la
 * croit pas », et `active`. `candidate`, `evaluee`, `suspendue` et `retiree`
 * ne tournent pas, et leur place dans le cycle est tenue par la base.
 */
const ETATS_QUI_DESIGNENT = ["observation", "active"] as const;

interface LigneDeVersion {
  recette_version_id: string;
  recette_id: string;
  rang: number;
  libelle: string;
  etat: string;
  definition: unknown;
}

interface LigneDeJeton {
  recette_version_id: string;
  piece_id: string;
  page: number;
  ordinal: number;
  text: string;
  x0: string | number;
  y0: string | number;
  x1: string | number;
  y1: string | number;
}

/**
 * Une désignation attendue : `page` / `ordinal`, et rien d'autre.
 *
 * `.strict()` n'est pas décoratif. C'est la dernière porte de R2 sur le
 * chemin des exemples : un `attendu` est un `jsonb`, et un `jsonb` accepte
 * n'importe quelle clé — y compris « valeur », qu'aucun type n'interdit une
 * fois la donnée écrite. Une facture arabe est sortie à 650 000 D là où le
 * papier portait 5 650 000 D parce qu'une valeur avait été recopiée au lieu
 * d'être relue ; un exemple qui PORTERAIT le montant attendu rouvrirait ce
 * chemin, et c'est la recette tout entière qui l'apprendrait.
 */
const Designation = z
  .object({
    page: z.number().int().min(1),
    ordinal: z.number().int().min(0),
    ordinalEnd: z.number().int().min(0).optional(),
  })
  .strict();

const Attendu = z.record(z.string().min(1).max(64), Designation);

const ExempleQualifie = z.object({
  tenantId: z.string().uuid(),
  pieceId: z.string().uuid(),
  signatureCle: z.string().min(1).max(200),
  provenance: z.enum(["validation_humaine", "correction_humaine", "import_expert", "observation"]),
  qualification: z.enum([
    "reconnaissance_ocr",
    "designation_champ",
    "normalisation",
    "document_incomplet",
    "decision_comptable",
  ]),
  usage: z.enum(["apprentissage", "evaluation"]),
  attendu: Attendu,
  note: z.string().max(2000).optional(),
});

const Candidate = z.object({
  tenantId: z.string().uuid(),
  libelle: z.string().min(1).max(200),
  signatureCle: z.string().min(1).max(200),
  portee: z.enum(["organisation", "mutualisee"]),
  definition: z.record(z.string(), z.unknown()),
  empreinte: z.string().regex(/^[0-9a-f]{64}$/),
  provenance: z.record(z.string(), z.unknown()),
  exemples: z.array(z.string().uuid()).min(1),
  motif: z.string().min(1).max(2000),
});

const Decision = z.object({
  tenantId: z.string().uuid(),
  recetteVersionId: z.string().uuid(),
  etat: z.enum(["candidate", "evaluee", "observation", "active", "suspendue", "retiree"]),
  evaluationId: z.string().uuid().optional(),
  motif: z.string().min(1).max(2000),
});

const Generation = z.object({
  tenantId: z.string().uuid(),
  modele: z.string().min(1).max(200),
  role: z.string().min(1).max(50),
  statut: z.string().min(1).max(50),
  latenceMs: z.number().int().min(0),
  tokensIn: z.number().int().min(0).nullish(),
  tokensOut: z.number().int().min(0).nullish(),
  erreur: z.string().max(2000).nullish(),
});

const Execution = z.object({
  tenantId: z.string().uuid(),
  recetteVersionId: z.string().uuid(),
  pieceId: z.string().uuid(),
  issue: z.enum(["designation", "abstention", "echec"]),
  motif: z.string().max(2000).nullish(),
  champsDesignes: z.number().int().min(0).nullish(),
  dureeMs: z.number().int().min(0).nullish(),
});

export const fabrique = {
  /**
   * Tout ce qu'une désignation par recette exige, en UN aller-retour.
   *
   * Un aller-retour, parce que ceci s'exécute au milieu d'une lecture : trois
   * appels seraient trois transactions, et la chaîne en ouvre déjà une par
   * RPC.
   *
   * ======================================= POURQUOI DES PLANS, ET PAS DES SIGNATURES
   *
   * La reconnaissance compare des SIGNATURES, et rien en base n'en stocke :
   * `signerLePlan` est pur et bon marché, et la signature a une version de
   * FORME qui rend incomparables deux signatures calculées par deux versions.
   * Les recalculer depuis les plans de jetons déjà persistés, c'est la
   * garantie qu'elles sont toutes de la même forme — une colonne de
   * signatures figées, elle, vieillirait en silence.
   *
   * Les plans rendus sont ceux des exemples d'APPRENTISSAGE, et seulement
   * eux : la jointure passe par `fabrique.recette_version_exemples`, dont la
   * clé étrangère refuse par construction un exemple d'évaluation. La
   * frontière n'est donc pas tenue par cette requête — elle est tenue par la
   * base, et cette requête ne peut pas la contourner.
   */
  async contexteDeDesignation(db: Requete, tenantId: string) {
    const [reglages, bornes] = await Promise.all([
      lireLesReglages(db, tenantId),
      lireLesBornesDeRecette(db, tenantId),
    ]);

    const { rows: versions } = await db.query<LigneDeVersion>(
      `select e.recette_version_id, e.recette_id, e.rang, e.libelle, e.etat::text as etat,
              v.definition
         from fabrique.etat_des_recettes_v e
         join fabrique.recette_versions v on v.id = e.recette_version_id
        where e.tenant_id = $1 and e.etat::text = any($2)
        order by e.recette_id, e.rang desc`,
      [tenantId, [...ETATS_QUI_DESIGNENT]],
    );
    if (versions.length === 0) {
      return { ...reglages, bornes, versions: [] };
    }

    const ids = versions.map((v) => v.recette_version_id);
    const { rows: jetons } = await db.query<LigneDeJeton>(
      `select rve.recette_version_id, e.piece_id,
              t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1
         from fabrique.recette_version_exemples rve
         join fabrique.exemples e on e.id = rve.exemple_id
         join token_plan_v t on t.piece_id = e.piece_id
        where rve.recette_version_id = any($1)
        order by rve.recette_version_id, e.piece_id, t.page, t.ordinal`,
      [ids],
    );

    const parVersion = new Map<string, Map<string, PageToken[]>>();
    for (const j of jetons) {
      let pieces = parVersion.get(j.recette_version_id);
      if (!pieces) {
        pieces = new Map<string, PageToken[]>();
        parVersion.set(j.recette_version_id, pieces);
      }
      const plan = pieces.get(j.piece_id) ?? [];
      plan.push({
        page: Number(j.page),
        ordinal: Number(j.ordinal),
        text: j.text,
        x0: Number(j.x0),
        y0: Number(j.y0),
        x1: Number(j.x1),
        y1: Number(j.y1),
      });
      pieces.set(j.piece_id, plan);
    }

    return {
      ...reglages,
      bornes,
      versions: versions.map((v) => ({
        versionId: v.recette_version_id,
        recetteId: v.recette_id,
        rang: Number(v.rang),
        libelle: v.libelle,
        etat: v.etat,
        definition: v.definition,
        plansDApprentissage: [...(parVersion.get(v.recette_version_id)?.values() ?? [])],
      })),
    };
  },

  /**
   * Inscrire ce qu'une exécution de recette a donné.
   *
   * C'est la seule réponse à « cette pièce a-t-elle été lue par une recette
   * ou par le modèle ? laquelle, dans quelle version, et si abstention pour
   * quel motif ? ». La table est en ajout seul (R7) et le `check` de la base
   * exige un motif dès que l'issue n'est pas une désignation — on ne le
   * redouble pas ici.
   */
  async inscrireExecution(db: Requete, saisie: unknown): Promise<void> {
    const e = Execution.parse(saisie);
    await db.query(
      `insert into fabrique.executions
         (tenant_id, recette_version_id, piece_id, issue, motif, champs_designes, duree_ms)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        e.tenantId,
        e.recetteVersionId,
        e.pieceId,
        e.issue,
        e.motif ?? null,
        e.champsDesignes ?? null,
        e.dureeMs ?? null,
      ],
    );
  },

  /**
   * Enregistrer le travail de lecture d'une pièce — DURABLEMENT.
   *
   * L'accusé que la route renvoie au téléphone part APRÈS ce retour, jamais
   * avant : aujourd'hui elle répond `{enCours:true}` sur une promesse en
   * mémoire, et un refus s'est déjà perdu de cette façon.
   *
   * L'organisation n'est pas un argument : elle se LIT sur la pièce, sous la
   * RLS. Un appelant qui la passerait pourrait nommer celle d'un autre, et
   * `pieces_v` est précisément ce qui refuse une pièce qu'on ne voit pas.
   *
   * La clé d'idempotence est la pièce elle-même : une pièce ne se lit qu'une
   * fois (R7), et la file hors ligne du téléphone rejoue.
   */
  async enregistrerLecture(
    db: Requete,
    pieceId: string,
  ): Promise<{ travailId: string; deja: boolean }> {
    const { rows } = await db.query<{ tenant_id: string }>(
      `select tenant_id from pieces_v where id = $1`,
      [pieceId],
    );
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) throw new Error("piece.not_found");

    return enregistrerTravail(db, {
      tenantId,
      pieceId,
      nature: "lecture_piece",
      cleIdempotence: `lecture_piece:${pieceId}`,
    });
  },

  /**
   * Où en est le travail qu'on a accusé — ce que l'écran lit au lieu de se
   * taire.
   *
   * C'est l'autre moitié de l'accusé : répondre « en cours » n'a de sens que
   * si l'on peut ensuite demander ce qu'il est devenu. L'état est DÉRIVÉ du
   * dernier fait inscrit (`fabrique.etat_des_travaux_v`), rien n'est stocké,
   * et la vue est `security_invoker` — c'est la RLS qui répond `null`.
   */
  async etatDeLaLecture(db: Requete, travailId: string) {
    return etatDuTravail(db, travailId);
  },

  /* ================================================ LE CYCLE DE VIE ====== */

  /**
   * Qualifier un exemple. Ce fait N'AUTORISE AUCUNE PROMOTION.
   *
   * Une validation humaine FOURNIT un exemple ; elle ne prouve rien de la
   * qualité d'une recette. Les deux faits sont distincts en base — tout
   * passage à `evaluee`, `observation` ou `active` exige une évaluation — et
   * ils le restent ici : cette méthode n'écrit jamais dans
   * `fabrique.promotions`.
   */
  async qualifierUnExemple(db: Requete, saisie: unknown): Promise<string> {
    const e = ExempleQualifie.parse(saisie);
    return qualifierUnExemple(db, e);
  },

  /**
   * Les exemples d'APPRENTISSAGE d'une signature, avec leur plan de jetons.
   *
   * C'est ce que le générateur reçoit. La clause `usage = 'apprentissage'`
   * n'est pas une précaution d'écriture : c'est la séparation que la base
   * tient par clé étrangère, et la respecter ici évite d'avoir à la
   * découvrir par un refus.
   */
  async exemplesDApprentissage(db: Requete, tenantId: string, signatureCle: string) {
    const { rows } = await db.query<LigneDeJeton & { exemple_id: string; attendu: unknown }>(
      `select e.id as exemple_id, e.piece_id, e.attendu,
              t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1
         from fabrique.exemples e
         join token_plan_v t on t.piece_id = e.piece_id
        where e.tenant_id = $1
          and e.signature_cle = $2
          and e.usage = 'apprentissage'
          and e.nourrit_une_recette
        order by e.id, t.page, t.ordinal`,
      [tenantId, signatureCle],
    );

    const par = new Map<
      string,
      { exempleId: string; pieceId: string; attendu: unknown; plan: PageToken[] }
    >();
    for (const j of rows) {
      let vu = par.get(j.exemple_id);
      if (!vu) {
        vu = { exempleId: j.exemple_id, pieceId: j.piece_id, attendu: j.attendu, plan: [] };
        par.set(j.exemple_id, vu);
      }
      vu.plan.push({
        page: Number(j.page),
        ordinal: Number(j.ordinal),
        text: j.text,
        x0: Number(j.x0),
        y0: Number(j.y0),
        x1: Number(j.x1),
        y1: Number(j.y1),
      });
    }
    return [...par.values()];
  },

  /**
   * Journaliser un appel du GÉNÉRATEUR — R8, et sans échappatoire.
   *
   * `public.agents_run_log` cherche un tarif par le COUPLE (modèle, rôle) et
   * LÈVE quand il n'en trouve pas. On ne rattrape pas cette levée : une
   * génération qui ne se journalise pas est une dépense qui disparaît, et
   * c'est exactement ce qui est arrivé quatre fois dans ce dépôt — dix jours
   * de désignations non mesurées la première.
   *
   * Elle s'appelle AUSSI quand la proposition est refusée : un appel refusé a
   * coûté autant qu'un appel retenu, et le plan demande le coût total par
   * document, génération comprise.
   */
  async journaliserUneGeneration(db: Requete, saisie: unknown): Promise<string | null> {
    const g = Generation.parse(saisie);
    const { rows } = await db.query<{ id: string | null }>(
      `select public.agents_run_log($1, $2, $3, $4, $5, $6::integer,
                                    $7::integer, $8::integer, null, $9) as id`,
      [
        g.tenantId,
        "fabrique.generateur",
        g.modele,
        g.role,
        g.statut,
        g.latenceMs,
        g.tokensIn ?? null,
        g.tokensOut ?? null,
        g.erreur ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  },

  /** Inscrire une recette candidate : version, exemples, décision de naissance. */
  async inscrireUneCandidate(db: Requete, saisie: unknown) {
    const c = Candidate.parse(saisie);
    return inscrireUneCandidate(db, c);
  },

  /**
   * Évaluer une version contre son jeu d'ÉVALUATION, et inscrire la mesure.
   *
   * Quand les données manquent, l'évaluation s'écrit quand même, sans la
   * mesure qu'on n'a pas pu calculer : la recette peut alors passer en
   * observation — elle s'exécute, on compare, on ne la croit pas — et la base
   * refuse l'activation, parce qu'une mesure absente reste absente.
   */
  async evaluerUneVersion(db: Requete, tenantId: string, recetteVersionId: string) {
    return evaluerUneVersion(db, tenantId, recetteVersionId);
  },

  /**
   * Inscrire une décision de cycle.
   *
   * Sans `if` : la transition permise, l'évaluation exigée, les seuils du
   * référentiel et le droit de décider (dirigeant ou expert) sont tenus par
   * `fabrique.verifier_promotion()` et par la politique d'écriture. Une règle
   * recopiée ici serait une seconde vérité, et c'est celle de l'application
   * qui se contourne.
   */
  async promouvoir(db: Requete, saisie: unknown): Promise<void> {
    const d = Decision.parse(saisie);
    await promouvoir(db, d);
  },

  /** L'état COURANT d'une version : le dernier fait inscrit, jamais un stock. */
  async etatDUneVersion(
    db: Requete,
    recetteVersionId: string,
  ): Promise<{ etat: EtatDeRecette; motif: string; evaluationId: string | null } | null> {
    return etatCourant(db, recetteVersionId);
  },

  /**
   * Surveiller une version qui tourne, et la SUSPENDRE si elle dérive.
   *
   * Suspendre suffit à rétablir le chemin existant : `contexteDeDesignation`
   * ne rend que les versions `observation` et `active`. Rien n'est perdu — ni
   * les pièces, ni les exécutions, ni les décisions — et la reprise
   * (`suspendue → observation`) est une transition que la base permet.
   */
  async surveillerUneVersion(db: Requete, tenantId: string, recetteVersionId: string) {
    return surveiller(db, tenantId, recetteVersionId);
  },
};
