/**
 * Le CYCLE DE VIE d'une recette — ce qui la fait avancer, et ce qui l'arrête.
 *
 * ================================================================= POURQUOI
 *
 * Le socle de données porte les neuf tables et le déclencheur qui tient les
 * transitions, retour arrière compris. Rien ne les fait AVANCER : une recette
 * naît candidate et y reste, parce qu'aucun code n'évalue, ne promeut, ne
 * surveille ni ne suspend. C'est ce que ce module écrit.
 *
 *   exemples qualifiés → candidate → évaluation → observation → active
 *                                         ↑            ↓
 *                                         └──── suspendue ────→ retirée
 *
 * ============================================ CE QUE LA BASE TIENT, ET PAS LUI
 *
 * Les transitions permises, l'exigence d'une évaluation, les seuils du
 * référentiel, le droit de promouvoir (dirigeant ou expert), l'ajout seul :
 * tout cela est dans `fabrique.verifier_promotion()` et dans les politiques.
 * Ce module ne les redouble PAS. Il appelle, et il laisse la base refuser —
 * une règle recopiée dans l'application est une règle qui dérive, et un écran
 * se contourne là où un déclencheur ne se contourne pas.
 *
 * Conséquence pratique : `promouvoir` n'a pas de `if`. Ce qu'il fait de plus
 * qu'un `insert`, c'est de ne jamais inventer l'évaluation.
 *
 * ================================== UNE VALIDATION HUMAINE N'EST PAS UNE PREUVE
 *
 * Elle FOURNIT un exemple ; elle n'autorise aucune promotion. Les deux faits
 * sont distincts et le restent ici : `qualifierUnExemple` écrit un exemple et
 * ne touche jamais `fabrique.promotions`.
 *
 * ========================================================== R4 — AUCUN SEUIL
 *
 * Aucun nombre qui décide n'est écrit dans ce fichier. La surveillance
 * compare un taux d'abstention mesuré au seuil `taux_abstention` du
 * référentiel, lu par `fabrique.seuils_exiges` — le même que celui de
 * l'activation, et pas un quatrième jeu.
 */
import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import type { Requete } from "../db.ts";

import { mesurer, type ComparaisonDUnExemple, type EcartMesure } from "./cycle-mesures.ts";
import { lireLesBornesDeRecette, lireLesReglages } from "./interprete-reglages.ts";
import { interpreter } from "./interprete.ts";
import type { CodeDAbstention } from "./recette.ts";
import { validerRecette } from "./recette-validateur.ts";

/**
 * Le code qui dit « un format a peut-être changé ».
 *
 * Il est ANNOTÉ, pas deviné : `CodeDAbstention` est l'ensemble fermé que
 * `recette.ts` dérive de `ReadFlag`, et le compilateur refuse ici un code qui
 * n'en ferait pas partie. Un index dans le tableau aurait tenu le même rôle
 * en silence, jusqu'au jour où quelqu'un insère un code avant lui.
 */
const AMBIGUE: CodeDAbstention = "DESIGNATION_AMBIGUE";

/**
 * Une désignation attendue par un exemple.
 *
 * C'est un `TokenRef`, à ceci près que `ordinalEnd` s'y écrit « absent ou
 * nombre » plutôt que « nombre » : le dépôt le reçoit d'un JSON, où une plage
 * non dite arrive `undefined`, et `exactOptionalPropertyTypes` distingue les
 * deux. Rien d'autre n'y est admis — ni texte, ni montant, ni date.
 */
interface DesignationAttendue {
  readonly page: number;
  readonly ordinal: number;
  readonly ordinalEnd?: number | undefined;
}

/** Les états du cycle, tels que `fabrique.etat_t` les nomme. */
export type EtatDeRecette =
  "candidate" | "evaluee" | "observation" | "active" | "suspendue" | "retiree";

/* ====================================== ① LA NAISSANCE D'UNE CANDIDATE === */

export interface NaissanceDeRecette {
  readonly tenantId: string;
  readonly libelle: string;
  readonly signatureCle: string;
  /** Pas de défaut : un partage ne naît pas d'un oubli (la base l'exige aussi). */
  readonly portee: "organisation" | "mutualisee";
  readonly definition: unknown;
  readonly empreinte: string;
  /** La provenance : qui a produit cette recette, avec quoi, sur quoi (⑤). */
  readonly provenance: unknown;
  /** Les exemples d'APPRENTISSAGE. La base refuse ceux d'évaluation. */
  readonly exemples: readonly string[];
  readonly motif: string;
}

/**
 * Inscrit une recette candidate, sa première version, ses exemples et sa
 * décision de naissance — en une transaction.
 *
 * La recette est retrouvée par sa `signature_cle` quand elle existe déjà :
 * une nouvelle version d'un format connu n'en crée pas un second, elle prend
 * le rang suivant. Le rang se calcule en base, pas ici — deux naissances
 * simultanées se départagent par la contrainte d'unicité, et l'une des deux
 * échoue au lieu d'écraser l'autre.
 */
export async function inscrireUneCandidate(
  db: Requete,
  n: NaissanceDeRecette,
): Promise<{ recetteId: string; versionId: string; rang: number }> {
  const { rows: existantes } = await db.query<{ id: string }>(
    `select id from fabrique.recettes where tenant_id = $1 and signature_cle = $2`,
    [n.tenantId, n.signatureCle],
  );
  let recetteId = existantes[0]?.id;
  if (!recetteId) {
    const { rows } = await db.query<{ id: string }>(
      `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
       values ($1, $2, $3, $4) returning id`,
      [n.tenantId, n.libelle, n.signatureCle, n.portee],
    );
    recetteId = rows[0]!.id;
  }

  const { rows: versions } = await db.query<{ id: string; rang: number }>(
    `insert into fabrique.recette_versions
       (tenant_id, recette_id, rang, definition, empreinte, provenance)
     select $1, $2, coalesce(max(v.rang), 0) + 1, $3, $4, $5
       from fabrique.recette_versions v
      where v.recette_id = $2
     returning id, rang`,
    [
      n.tenantId,
      recetteId,
      JSON.stringify(n.definition),
      n.empreinte,
      JSON.stringify(n.provenance),
    ],
  );
  const version = versions[0]!;

  for (const exempleId of n.exemples) {
    await db.query(
      `insert into fabrique.recette_version_exemples
         (tenant_id, recette_version_id, exemple_id, nourrit_une_recette, usage)
       values ($1, $2, $3, true, 'apprentissage')`,
      [n.tenantId, version.id, exempleId],
    );
  }

  await db.query(
    `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
     values ($1, $2, 'candidate', $3)`,
    [n.tenantId, version.id, n.motif],
  );

  return { recetteId, versionId: version.id, rang: Number(version.rang) };
}

/* ============================================ ② L'EXEMPLE QUALIFIÉ ======= */

export interface ExempleAQualifier {
  readonly tenantId: string;
  readonly pieceId: string;
  readonly signatureCle: string;
  readonly provenance:
    "validation_humaine" | "correction_humaine" | "import_expert" | "observation";
  readonly qualification:
    | "reconnaissance_ocr"
    | "designation_champ"
    | "normalisation"
    | "document_incomplet"
    | "decision_comptable";
  readonly usage: "apprentissage" | "evaluation";
  /** Des désignations, jamais des valeurs : la relecture reste à la chaîne. */
  readonly attendu: Readonly<Record<string, DesignationAttendue>>;
  readonly note?: string | undefined;
}

/**
 * Qualifie un exemple. Ce fait N'AUTORISE AUCUNE PROMOTION.
 *
 * Une décision comptable passe ici comme les autres : elle s'inscrit, elle
 * est lisible, et la colonne calculée `nourrit_une_recette` la met hors de
 * portée de l'apprentissage. On ne la refuse pas — un expert qui requalifie
 * une imputation doit pouvoir le dire —, on l'empêche de devenir une règle
 * de lecture, ce qui n'est pas la même chose.
 */
export async function qualifierUnExemple(db: Requete, e: ExempleAQualifier): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into fabrique.exemples
       (tenant_id, piece_id, signature_cle, provenance, qualification, usage, attendu, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      e.tenantId,
      e.pieceId,
      e.signatureCle,
      e.provenance,
      e.qualification,
      e.usage,
      JSON.stringify({ champs: e.attendu }),
      e.note ?? null,
    ],
  );
  return rows[0]!.id;
}

/* ================================================= ③ L'ÉVALUATION ======== */

export interface ResultatDEvaluation {
  readonly evaluationId: string;
  readonly mesures: Readonly<Record<string, number>>;
  readonly absentes: readonly string[];
  readonly exemplesComptes: number;
  readonly ecarts: readonly EcartMesure[];
  /**
   * Pourquoi cette évaluation ne suffit pas à activer, quand c'est le cas.
   * `null` ne promet rien : c'est la base qui tranche, contre ses seuils.
   */
  readonly reserve: string | null;
}

interface LigneDeJeton {
  exemple_id: string;
  piece_id: string;
  attendu: unknown;
  page: number;
  ordinal: number;
  text: string;
  x0: string | number;
  y0: string | number;
  x1: string | number;
  y1: string | number;
}

/** Les désignations attendues d'un `attendu` stocké. Rien d'autre n'en sort. */
function attenduDe(brut: unknown): Record<string, TokenRef> {
  if (typeof brut !== "object" || brut === null) return {};
  const champs = (brut as { champs?: unknown }).champs;
  if (typeof champs !== "object" || champs === null) return {};
  const sortie: Record<string, TokenRef> = {};
  for (const [nom, v] of Object.entries(champs as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const r = v as { page?: unknown; ordinal?: unknown; ordinalEnd?: unknown };
    if (typeof r.page !== "number" || typeof r.ordinal !== "number") continue;
    sortie[nom] =
      typeof r.ordinalEnd === "number"
        ? { page: r.page, ordinal: r.ordinal, ordinalEnd: r.ordinalEnd }
        : { page: r.page, ordinal: r.ordinal };
  }
  return sortie;
}

/**
 * Évalue une version contre son jeu d'ÉVALUATION, et inscrit la mesure.
 *
 * ================================ POURQUOI ON NE COMPLÈTE PAS AVEC L'APPRENTISSAGE
 *
 * Jamais, même « parce qu'il y en a peu ». Une recette mesurée sur ce qui l'a
 * produite rend toujours 1,00, et ce 1,00 franchit tous les seuils. La
 * requête ci-dessous ne peut d'ailleurs pas le faire : la jointure passe par
 * `usage = 'evaluation'`, et `fabrique.evaluation_exemples` refuserait l'autre
 * par clé étrangère.
 *
 * Quand les données manquent, l'évaluation s'écrit QUAND MÊME, avec ses
 * mesures absentes et sa réserve en clair. La recette peut alors passer en
 * observation — elle s'exécute, on compare, on ne la croit pas — et la base
 * refuse l'activation parce que la mesure exigée n'est pas là.
 */
export async function evaluerUneVersion(
  db: Requete,
  tenantId: string,
  recetteVersionId: string,
): Promise<ResultatDEvaluation> {
  const { rows: versions } = await db.query<{ definition: unknown; signature_cle: string }>(
    `select v.definition, r.signature_cle
       from fabrique.recette_versions v
       join fabrique.recettes r on r.id = v.recette_id
      where v.id = $1 and v.tenant_id = $2`,
    [recetteVersionId, tenantId],
  );
  const version = versions[0];
  if (!version) throw new Error(`recette_version introuvable ou non lisible : ${recetteVersionId}`);

  const [reglages, bornes] = await Promise.all([
    lireLesReglages(db, tenantId),
    lireLesBornesDeRecette(db, tenantId),
  ]);

  /* Le validateur strict, à l'évaluation aussi. Une recette stockée peut
     avoir été écrite par un autre chemin que le générateur, et les bornes du
     cabinet ont pu changer depuis. On ne mesure pas ce qu'on refuserait. */
  const validee = validerRecette(version.definition, bornes);
  if (!validee.ok) {
    throw new Error(
      "recette refusée par le validateur à l'évaluation : " +
        validee.refus.map((r) => `${r.code} (${r.ou})`).join(", "),
    );
  }

  const { rows: jetons } = await db.query<LigneDeJeton>(
    `select e.id as exemple_id, e.piece_id, e.attendu,
            t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1
       from fabrique.exemples e
       join token_plan_v t on t.piece_id = e.piece_id
      where e.tenant_id = $1
        and e.signature_cle = $2
        and e.usage = 'evaluation'
        and e.nourrit_une_recette
      order by e.id, t.page, t.ordinal`,
    [tenantId, version.signature_cle],
  );

  const parExemple = new Map<string, { pieceId: string; attendu: unknown; plan: PageToken[] }>();
  for (const j of jetons) {
    let vu = parExemple.get(j.exemple_id);
    if (!vu) {
      vu = { pieceId: j.piece_id, attendu: j.attendu, plan: [] };
      parExemple.set(j.exemple_id, vu);
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

  const comparaisons: ComparaisonDUnExemple[] = [...parExemple.values()].map((e) => ({
    pieceId: e.pieceId,
    attendu: attenduDe(e.attendu),
    obtenu: interpreter(validee.recette, e.plan, reglages.signature),
  }));

  const mesure = mesurer(comparaisons);
  const reserve =
    mesure.absentes.length === 0
      ? null
      : "données d'évaluation insuffisantes — " + mesure.absentes.join(" ; ");

  const { rows } = await db.query<{ id: string }>(
    `insert into fabrique.evaluations (tenant_id, recette_version_id, mesures, exemples_comptes)
     values ($1, $2, $3, $4) returning id`,
    [tenantId, recetteVersionId, JSON.stringify(mesure.mesures), mesure.exemplesComptes],
  );
  const evaluationId = rows[0]!.id;

  for (const exempleId of parExemple.keys()) {
    await db.query(
      `insert into fabrique.evaluation_exemples
         (tenant_id, evaluation_id, exemple_id, usage)
       values ($1, $2, $3, 'evaluation')`,
      [tenantId, evaluationId, exempleId],
    );
  }

  return {
    evaluationId,
    mesures: mesure.mesures,
    absentes: mesure.absentes,
    exemplesComptes: mesure.exemplesComptes,
    ecarts: mesure.ecarts,
    reserve,
  };
}

/* ================================================== ④ LA PROMOTION ====== */

/**
 * Inscrit une décision de cycle. Sans `if`, et c'est voulu.
 *
 * La transition, l'évaluation exigée, les seuils et le droit de décider sont
 * tenus par `fabrique.verifier_promotion()` et par la politique d'écriture.
 * Les redoubler ici produirait deux vérités : celle de l'application, qu'on
 * peut contourner, et celle de la base, qui est la seule à tenir.
 */
export async function promouvoir(
  db: Requete,
  p: {
    tenantId: string;
    recetteVersionId: string;
    etat: EtatDeRecette;
    evaluationId?: string | undefined;
    motif: string;
  },
): Promise<void> {
  await db.query(
    `insert into fabrique.promotions
       (tenant_id, recette_version_id, etat, evaluation_id, motif)
     values ($1, $2, $3, $4, $5)`,
    [p.tenantId, p.recetteVersionId, p.etat, p.evaluationId ?? null, p.motif],
  );
}

/** L'état COURANT d'une version : le dernier fait inscrit, jamais un stock. */
export async function etatCourant(
  db: Requete,
  recetteVersionId: string,
): Promise<{ etat: EtatDeRecette; motif: string; evaluationId: string | null } | null> {
  const { rows } = await db.query<{
    etat: EtatDeRecette;
    motif: string;
    evaluation_id: string | null;
  }>(
    `select etat::text as etat, motif, evaluation_id
       from fabrique.etat_des_recettes_v where recette_version_id = $1`,
    [recetteVersionId],
  );
  const r = rows[0];
  return r ? { etat: r.etat, motif: r.motif, evaluationId: r.evaluation_id } : null;
}

/* ================================================= ⑤ LA SURVEILLANCE ==== */

/** Ce qu'une surveillance a constaté, et ce qu'elle en a fait. */
export interface Surveillance {
  readonly etatAvant: EtatDeRecette | null;
  readonly executions: number;
  readonly abstentions: number;
  /** `null` quand rien ne s'est exécuté : un taux sur zéro n'est pas un taux. */
  readonly tauxAbstention: number | null;
  readonly tolere: number | null;
  readonly derive: "abstention_en_hausse" | "signature_changee" | null;
  readonly suspendue: boolean;
}

/**
 * Surveille une version qui tourne, et la SUSPEND si elle dérive.
 *
 * ================================================= CE QUI REND LA MAIN, ET COMMENT
 *
 * Suspendre suffit à rétablir le chemin existant : `contexteDeDesignation`
 * ne rend que les versions `observation` et `active`, donc une version
 * suspendue cesse d'être candidate à la reconnaissance et la pièce suivante
 * repart vers le modèle. Rien n'est perdu — ni les pièces, ni les exécutions,
 * ni les décisions : `fabrique.promotions` est en ajout seul, et la reprise
 * (`suspendue → observation`) est une transition que la base permet.
 *
 * ============================================= POURQUOI « DESIGNATION_AMBIGUE »
 *
 * Ce code dit qu'il y avait PLUSIEURS candidats là où la recette en attendait
 * un : c'est la signature d'un format qui a changé, pas d'une règle trop
 * étroite. La dérive porte alors ce nom-là, et pas « abstention en hausse » —
 * les deux appellent des suites différentes, et les confondre ferait
 * ressaisir une recette correcte au lieu d'en écrire une nouvelle version.
 */
export async function surveiller(
  db: Requete,
  tenantId: string,
  recetteVersionId: string,
): Promise<Surveillance> {
  const etat = await etatCourant(db, recetteVersionId);
  const etatAvant = etat?.etat ?? null;

  /* Les exécutions DEPUIS la dernière décision. Une recette remise en
     observation après correction ne traîne pas les abstentions de sa vie
     précédente : ce serait la condamner sur un passé qu'on a déjà traité. */
  const { rows } = await db.query<{ issue: string; motif: string | null }>(
    `select x.issue::text as issue, x.motif
       from fabrique.executions x
      where x.recette_version_id = $1
        and x.executee_le >= coalesce(
              (select max(p.decide_le) from fabrique.promotions p
                where p.recette_version_id = $1), x.executee_le)`,
    [recetteVersionId],
  );

  const executions = rows.length;
  const abstentions = rows.filter((r) => r.issue === "abstention").length;
  const ambigue = rows.some((r) => r.motif?.includes(AMBIGUE) === true);
  const taux = executions === 0 ? null : abstentions / executions;

  const { rows: seuils } = await db.query<{ exigence: string }>(
    `select exigence from fabrique.seuils_exiges($1) where mesure = $2 and sens = 'max'`,
    [tenantId, "taux_abstention"],
  );
  const tolere = seuils[0] === undefined ? null : Number(seuils[0].exigence);

  const depasse = taux !== null && tolere !== null && taux > tolere;
  const derive = depasse ? (ambigue ? "signature_changee" : "abstention_en_hausse") : null;

  if (derive === null) {
    return {
      etatAvant,
      executions,
      abstentions,
      tauxAbstention: taux,
      tolere,
      derive: null,
      suspendue: false,
    };
  }

  await db.query(
    `insert into fabrique.derives (tenant_id, recette_version_id, nature, mesure)
     values ($1, $2, $3, $4)`,
    [
      tenantId,
      recetteVersionId,
      derive,
      JSON.stringify({
        executions,
        abstentions,
        taux_abstention: taux,
        tolere,
      }),
    ],
  );

  /* On ne suspend que ce qui tourne. Une version déjà suspendue ou retirée
     n'a pas à recevoir une transition que la base refuserait de toute façon —
     et la dérive, elle, reste inscrite : le constat n'est pas perdu. */
  const suspendable = etatAvant === "observation" || etatAvant === "active";
  if (suspendable) {
    await promouvoir(db, {
      tenantId,
      recetteVersionId,
      etat: "suspendue",
      motif:
        `dérive ${derive} : ${String(abstentions)} abstention(s) sur ${String(executions)} ` +
        `exécution(s), au-delà de ${String(tolere)} toléré`,
    });
  }

  return {
    etatAvant,
    executions,
    abstentions,
    tauxAbstention: taux,
    tolere,
    derive,
    suspendue: suspendable,
  };
}
