/**
 * La file durable des travaux — le côté application.
 *
 * ============================================================== POURQUOI
 *
 * Lire une pièce est aujourd'hui une promesse en mémoire du processus
 * (`malica/lecture/lectures-en-cours.ts`, dont l'en-tête dit lui-même sa
 * limite : « le jour où il y en a deux, ce module devient une table »). Le
 * processus meurt, la lecture meurt — et une pièce peut être lue, persistée,
 * et jamais comptée.
 *
 * Ce module ne tient AUCUNE règle. Les règles — qui peut prendre, quand, pour
 * la combientième fois, et ce que chaque échec déclenche — vivent dans
 * `db/migrations/20261020120000_…`. Ici on appelle, et on rend ce que la base
 * répond. C'est R3 appliqué à l'orchestration : l'application n'émet aucune
 * valeur liante.
 *
 * =================================================== CE QU'IL NE FAIT PAS
 *
 * Il n'écrit JAMAIS dans `facturation.lectures`. `public.lecture_consommer`
 * en est la seule porte depuis le 19 octobre, elle est `security definer`,
 * elle refuse si son propre verdict n'autorise pas, et elle ne compte jamais
 * deux fois la même pièce. La file ne la contourne pas : elle n'en a même pas
 * le droit.
 *
 * Il n'appelle aucun organe payant et n'en introduit aucun : la file
 * ORCHESTRE la chaîne existante, dont chaque appel reste journalisé dans
 * `agents.agent_runs` par `read-flow.ts`. Aucune ligne de tarif nouvelle
 * n'est donc requise (R8).
 */

import type { Requete } from "../db.ts";

/**
 * Ce qu'un travail fait. Le type est celui de l'énumération en base.
 *
 * `generation_recette` ne vise pas une pièce mais un FORMAT : sa cible est la
 * clé de signature portée par `fabrique.travaux.signature_cle`, et la base
 * refuse un travail de cette nature qui n'en porte pas.
 */
export type NatureDeTravail = "lecture_piece" | "generation_recette";

/** Les issues qu'une tentative peut inscrire. « pris » n'en est pas une. */
export type IssueDeTentative =
  "termine" | "refus_metier" | "panne_fournisseur" | "erreur_technique";

/** Les états dérivés que la vue rend. Ils ne sont stockés nulle part. */
// Non exporté : rien hors de ce module ne le nomme, et R9 ne tolère pas un
// export que personne n'importe. Il reste un type, lu par « EtatLu.etat ».
type EtatDeTravail =
  "a_faire" | "en_cours" | "abandonne" | "en_panne" | "epuise" | "termine" | "refuse" | "en_erreur";

export interface TravailPris {
  travailId: string;
  pieceId: string;
  nature: NatureDeTravail;
  /** Le format visé, pour une génération. Nul pour une lecture. */
  signatureCle: string | null;
  tentative: number;
  faitId: string;
}

export interface EtatLu {
  travailId: string;
  pieceId: string;
  nature: NatureDeTravail;
  etat: EtatDeTravail;
  tentatives: number;
  dernierFait: string | null;
  dernierMotif: string | null;
  dernierLe: Date | null;
  prenable: boolean;
  prenableA: Date | null;
}

export interface Borne {
  valeur: number;
  arreteParLeCabinet: boolean;
}

/**
 * Enregistre un travail, et ne rend la main qu'UNE FOIS L'ÉCRITURE FAITE.
 *
 * C'est la règle qui justifie toute cette file. Aujourd'hui la route répond
 * `{enCours:true}` avant que quoi que ce soit existe, et un refus
 * d'arrière-plan s'est déjà perdu. L'accusé de prise en charge que l'appelant
 * renverra au téléphone doit partir APRÈS ce retour, jamais avant.
 *
 * Idempotent par `cleIdempotence` : la file hors ligne rejoue, et un rejeu ne
 * doit pas doubler la dépense. `deja` dit lequel des deux cas on est, parce
 * qu'un appelant qui ne peut pas le savoir finit par supposer.
 */
export async function enregistrerTravail(
  db: Requete,
  travail: {
    tenantId: string;
    pieceId: string;
    nature: NatureDeTravail;
    cleIdempotence: string;
    /** Laissée au défaut du schéma quand elle n'est pas dite — R4 : aucun nombre ici. */
    priorite?: number;
  },
): Promise<{ travailId: string; deja: boolean }> {
  // Une priorité non dite n'est PAS écrite : la colonne prend le défaut du
  // schéma, visible en base. C'est ainsi qu'aucun nombre ne vit ici (R4).
  const avecPriorite = travail.priorite !== undefined;
  const { rows } = await db.query<{ id: string }>(
    `insert into fabrique.travaux
       (tenant_id, piece_id, nature, cle_idempotence${avecPriorite ? ", priorite" : ""})
     values ($1, $2, $3, $4${avecPriorite ? ", $5" : ""})
     on conflict (tenant_id, cle_idempotence) do nothing
     returning id`,
    avecPriorite
      ? [
          travail.tenantId,
          travail.pieceId,
          travail.nature,
          travail.cleIdempotence,
          travail.priorite,
        ]
      : [travail.tenantId, travail.pieceId, travail.nature, travail.cleIdempotence],
  );
  if (rows[0]) return { travailId: rows[0].id, deja: false };

  const deja = await db.query<{ id: string }>(
    `select id from fabrique.travaux where tenant_id = $1 and cle_idempotence = $2`,
    [travail.tenantId, travail.cleIdempotence],
  );
  if (!deja.rows[0]) {
    // Ni inséré, ni lisible : la politique a refusé l'écriture sans lever.
    // On ne rend surtout pas un identifiant inventé.
    throw new Error(
      `travail non enregistré et non lisible — tenant ${travail.tenantId}, clé ${travail.cleIdempotence}`,
    );
  }
  return { travailId: deja.rows[0].id, deja: true };
}

/**
 * Prend le travail le plus prioritaire, ou rend `null`.
 *
 * LA PRISE EST UN FAIT NOUVEAU, pas un `update`. On ne lit jamais un nombre
 * de lignes touchées : sur une table en ajout seul, un `update` sous identité
 * réelle touche zéro ligne EN SILENCE, parce qu'une politique absente
 * n'arrête pas — elle ignore. Ici, ou la base rend une ligne, ou il n'y avait
 * rien à prendre.
 *
 * `natures` dit ce que l'appelant SAIT exécuter, et il ne prend rien d'autre.
 * Sans ce filtre, un travail de génération serait pris puis exécuté comme une
 * lecture — et un coureur sans générateur configuré épuiserait les trois
 * tentatives d'une génération contre une clé absente au lieu de la laisser
 * attendre.
 */
export async function prendreUnTravail(
  db: Requete,
  tenantId: string,
  natures?: readonly NatureDeTravail[],
): Promise<TravailPris | null> {
  const { rows } = await db.query<{
    travail_id: string;
    piece_id: string;
    nature: NatureDeTravail;
    signature_cle: string | null;
    tentative: number;
    fait_id: string;
  }>(`select * from fabrique.travail_prendre($1, $2)`, [tenantId, natures ?? null]);
  const r = rows[0];
  if (!r) return null;
  return {
    travailId: r.travail_id,
    pieceId: r.piece_id,
    nature: r.nature,
    signatureCle: r.signature_cle,
    tentative: r.tentative,
    faitId: r.fait_id,
  };
}

/**
 * Inscrit l'issue d'une tentative.
 *
 * Le motif est obligatoire pour les trois échecs — la base le refuse sinon.
 * « Échec sans motif est une tâche oubliée qui se déguise en fait acquis »
 * (`20260902130000`), et ce dépôt l'a déjà payé.
 */
export async function inscrireIssue(
  db: Requete,
  issue: {
    tenantId: string;
    travailId: string;
    tentative: number;
    nature: IssueDeTentative;
    motif?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `insert into fabrique.travail_faits
       (tenant_id, travail_id, tentative, nature, motif, detail)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      issue.tenantId,
      issue.travailId,
      issue.tentative,
      issue.nature,
      issue.motif ?? null,
      issue.detail ? JSON.stringify(issue.detail) : null,
    ],
  );
}

/**
 * Où en est un travail — ce que l'écran lit au lieu de se taire.
 *
 * `null` quand le travail n'existe pas, ou que l'appelant ne le voit pas : la
 * vue est `security_invoker`, et c'est la RLS qui répond.
 */
export async function etatDuTravail(db: Requete, travailId: string): Promise<EtatLu | null> {
  const { rows } = await db.query<{
    travail_id: string;
    piece_id: string;
    nature: NatureDeTravail;
    etat: EtatDeTravail;
    tentatives: number;
    dernier_fait: string | null;
    dernier_motif: string | null;
    dernier_le: Date | null;
    prenable: boolean;
    prenable_a: Date | null;
  }>(`select * from fabrique.etat_des_travaux_v where travail_id = $1`, [travailId]);
  const r = rows[0];
  if (!r) return null;
  return {
    travailId: r.travail_id,
    pieceId: r.piece_id,
    nature: r.nature,
    etat: r.etat,
    tentatives: r.tentatives,
    dernierFait: r.dernier_fait,
    dernierMotif: r.dernier_motif,
    dernierLe: r.dernier_le,
    prenable: r.prenable,
    prenableA: r.prenable_a,
  };
}

/**
 * Les trois bornes en vigueur : ce que le cabinet a arrêté, puis le défaut du
 * pack. Une borne absente du référentiel LÈVE — aucun repli implicite (R4).
 */
export async function bornesDeTravail(
  db: Requete,
  tenantId: string,
): Promise<Record<string, Borne>> {
  const { rows } = await db.query<{
    borne: string;
    valeur: string;
    arrete_par_le_cabinet: boolean;
  }>(`select * from fabrique.bornes_de_travail($1)`, [tenantId]);
  return Object.fromEntries(
    rows.map((r) => [
      r.borne,
      { valeur: Number(r.valeur), arreteParLeCabinet: r.arrete_par_le_cabinet },
    ]),
  );
}

/**
 * Propose une génération pour ce format, SI la base l'autorise.
 *
 * Aucune règle ici — ni le nombre d'exemples, ni « pas deux fois », ni « pas
 * si un lecteur existe déjà » : les trois vivent dans
 * `fabrique.generation_proposer`, avec le seuil qui vient du référentiel et
 * se surcharge par cabinet. C'est R3 appliqué à l'orchestration : on appelle,
 * et on rend ce que la base répond.
 *
 * `null` n'est pas une erreur. C'est la réponse la plus fréquente : le seuil
 * n'est pas atteint, ou la génération est déjà en file.
 */
export async function proposerUneGeneration(
  db: Requete,
  tenantId: string,
  signatureCle: string,
): Promise<string | null> {
  const { rows } = await db.query<{ travail: string | null }>(
    `select fabrique.generation_proposer($1, $2) as travail`,
    [tenantId, signatureCle],
  );
  return rows[0]?.travail ?? null;
}
