/**
 * Où en est la lecture d'une pièce — UNE règle, pour tous les écrans.
 *
 * ================================================================== POURQUOI
 *
 * 24 octobre 2026, Wissem : « rien ne dit que la lecture casse ». L'écran
 * « Je lis » montrait l'état du travail en un mot gris, l'accueil et la
 * bibliothèque ne le montraient pas du tout, et la fiche avait sa propre
 * table de codes. Une pièce dont la lecture avait échoué restait rangée
 * « à lire », comme si de rien n'était.
 *
 * Cette fonction tranche, à partir de ce que la base dit de la pièce
 * (`PieceLue`) et rien d'autre. Chaque écran l'appelle ; aucun ne refait le
 * raisonnement.
 *
 * ========================================= DEUX ÉCHECS, ET ILS NE DEMANDENT PAS LA MÊME CHOSE
 *
 * - `a_reprendre` : la PHOTO ne se lit pas (floue, vide, trop dense). Seule
 *   la personne peut agir — reprendre la photo. Rouge.
 * - `attente` : le LECTEUR n'a pas répondu (panne, délai). La file durable
 *   réessaie seule ; personne n'a rien à faire. Ambre.
 * - `echec` : la file a épuisé ses essais, ou une erreur qu'elle ne sait pas
 *   nommer. On propose de relire. Rouge.
 */

import type { EtatDUnTravail, LectureRefusee } from "./ports/repositories.ts";

/**
 * Les codes de lecture que la chaîne lève elle-même (`read-flow.ts`,
 * `vision.ts`) et que l'écran sait dire. Un motif qui n'en contient aucun
 * n'est JAMAIS montré tel quel : il peut porter un message technique.
 */
const CODES_PHOTO = ["lecture.illisible", "lecture.vide", "lecture.trop_dense"] as const;
const CODES_CONNUS = [...CODES_PHOTO, "lecture.trop_longue"] as const;
export type CodeDeLecture = (typeof CODES_CONNUS)[number];

/** Le code `lecture.*` porté par un motif d'échec, ou `null`. */
export function codeDeLecture(motif: string | null | undefined): CodeDeLecture | null {
  const trouve = motif?.match(/lecture\.[a-z_]+/)?.[0];
  return CODES_CONNUS.find((c) => c === trouve) ?? null;
}

/** Ce que la base dit du DERNIER travail de lecture d'une pièce. */
export interface DerniereLecture {
  etat: EtatDUnTravail;
  /** Quand cette lecture a été demandée : un refus plus ancien ne la cache pas. */
  demandeLe: string;
  /** Le code reconnu dans le motif du dernier échec — jamais le motif brut. */
  code: CodeDeLecture | null;
  /** Quand la file réessaiera d'elle-même, pour une panne. */
  reessaieLe: string | null;
}

export type IssueDeLecture =
  | { kind: "lue" }
  | { kind: "en_cours" }
  | { kind: "attente"; reessaieLe: string | null }
  | { kind: "a_reprendre"; code: CodeDeLecture }
  | { kind: "echec"; code: CodeDeLecture | null }
  | { kind: "refusee"; motif: string }
  | { kind: "a_lire" };

export function issueDeLecture(
  p: {
    status: string;
    lectureRefusee?: LectureRefusee | null;
    lecture?: DerniereLecture | null;
  },
  maintenant: number = Date.now(),
): IssueDeLecture {
  if (p.status !== "capturee") return { kind: "lue" };
  const l = p.lecture;
  /*
   * Le refus l'emporte — sauf sur une lecture demandée APRÈS lui : un forfait
   * relevé, puis « Relire », ne doit pas rester affiché « refusée » pendant
   * que la nouvelle lecture tourne.
   */
  const refus = p.lectureRefusee;
  if (refus && (!l || Date.parse(refus.le) >= Date.parse(l.demandeLe))) {
    return { kind: "refusee", motif: refus.motif };
  }
  if (!l) return { kind: "a_lire" };
  switch (l.etat) {
    // « termine » alors que la pièce est encore « capturée » : la liste qui
    // dira « lue » est en route. On ne déclare pas d'échec sur un succès.
    case "a_faire":
    case "en_cours":
    case "termine":
      return { kind: "en_cours" };
    /*
     * ATTENTE N'EST VRAI QUE JUSQU'À L'HEURE DE REPRISE. Aucun démon ne
     * reprend un travail tout seul : la file reprend au prochain appel d'un
     * membre de l'organisation (`coureur.ts`). Passé `reessaieLe`, « je
     * réessaie seule » mentirait, et la pièce disparaîtrait de tous les écrans
     * (ni à lire, ni en échec). On propose donc « Relire » : la même clé
     * retrouve le travail, et l'appel relance la file (revue du 24 octobre).
     */
    case "abandonne":
    case "en_panne":
      return l.reessaieLe && Date.parse(l.reessaieLe) > maintenant
        ? { kind: "attente", reessaieLe: l.reessaieLe }
        : { kind: "echec", code: l.code };
    case "refuse":
      // Le refus d'une lecture d'arrière-plan s'inscrit aussi sur la pièce ;
      // tant qu'il n'y est pas, on ne l'invente pas.
      return { kind: "echec", code: l.code };
    case "epuise":
    case "en_erreur":
      return l.code && (CODES_PHOTO as readonly string[]).includes(l.code)
        ? { kind: "a_reprendre", code: l.code }
        : { kind: "echec", code: l.code };
  }
}

/** Une issue qui demande un geste de la personne : rouge, avec ses boutons. */
export type EchecDeLecture = Extract<IssueDeLecture, { kind: "a_reprendre" | "echec" }>;

export function demandeUnGeste(i: IssueDeLecture): i is EchecDeLecture {
  return i.kind === "a_reprendre" || i.kind === "echec";
}
