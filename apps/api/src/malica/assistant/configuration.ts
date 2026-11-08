/**
 * La configuration de « Parler à Malica », lue en base — jamais écrite ici.
 *
 * La consigne (le prompt système) est versionnée dans
 * `plateforme.assistant_consignes` ; le réglage (modèles, règle de difficulté,
 * effort, réflexion, nombre de tours d'outils, borne de sortie) dans
 * `plateforme.assistant_reglages`. La tour publie une version nouvelle de
 * l'une ou l'autre, datée et motivée (R10) ; le code n'en porte aucune (R4,
 * R8). Une configuration incomplète est une panne qui se dit, pas un repli
 * silencieux sur une consigne écrite en TypeScript.
 */

import type { TarifDeModele } from "../conseil/cite.ts";

export type Effort = "low" | "medium" | "high";
export type Reflexion = "disabled" | "between_tools" | "adaptive";

export interface ReglageDeLAssistant {
  modele_courant: string;
  modele_difficile: string;
  longueur_difficile: number;
  mots_difficiles: string[];
  effort_courant: Effort;
  effort_difficile: Effort;
  reflexion_courant: Reflexion;
  reflexion_difficile: Reflexion;
  iterations_max: number;
  sortie_max_jetons: number;
  tours_transmis: number;
}

export interface ConfigurationDeLAssistant {
  consigne: { id: string; texte: string; decide_le: string };
  reglage: ReglageDeLAssistant;
  tarifs: TarifDeModele[];
}

const EFFORTS: readonly Effort[] = ["low", "medium", "high"];
const REFLEXIONS: readonly Reflexion[] = ["disabled", "between_tools", "adaptive"];

export function lireConfigurationAssistant(brut: unknown): ConfigurationDeLAssistant {
  const c = brut as Partial<ConfigurationDeLAssistant> | null;
  if (!c?.consigne?.texte?.trim()) throw new Error("assistant.consigne_absente");
  const r = c.reglage;
  if (!r?.modele_courant || !r.modele_difficile) throw new Error("assistant.reglage_absent");
  const effort = (e: unknown): Effort => {
    if (!EFFORTS.includes(e as Effort)) throw new Error("assistant.reglage_absent");
    return e as Effort;
  };
  const reflexion = (x: unknown): Reflexion => {
    if (!REFLEXIONS.includes(x as Reflexion)) throw new Error("assistant.reglage_absent");
    return x as Reflexion;
  };
  return {
    consigne: c.consigne,
    reglage: {
      modele_courant: r.modele_courant,
      modele_difficile: r.modele_difficile,
      longueur_difficile: Number(r.longueur_difficile),
      mots_difficiles: Array.isArray(r.mots_difficiles) ? r.mots_difficiles : [],
      effort_courant: effort(r.effort_courant),
      effort_difficile: effort(r.effort_difficile),
      reflexion_courant: reflexion(r.reflexion_courant),
      reflexion_difficile: reflexion(r.reflexion_difficile),
      iterations_max: Number(r.iterations_max),
      sortie_max_jetons: Number(r.sortie_max_jetons),
      tours_transmis: Number(r.tours_transmis),
    },
    tarifs: (c.tarifs ?? []).map((t) => ({ ...t, in: Number(t.in), out: Number(t.out) })),
  };
}

export interface ChoixDuModele {
  modele: string;
  effort: Effort;
  reflexion: Reflexion;
  difficile: boolean;
  motif: "longueur" | "mot" | "pieces" | null;
}

/**
 * Haiku par défaut ; le modèle des questions difficiles quand la question
 * dépasse la longueur réglée, contient l'un des mots réglés, ou joint
 * plusieurs pièces. Une règle simple, lisible et réglable dans la tour.
 */
export function choisirLeModele(
  question: string,
  nbPiecesJointes: number,
  reglage: ReglageDeLAssistant,
): ChoixDuModele {
  const q = question.toLocaleLowerCase("fr");
  const motif =
    question.trim().length > reglage.longueur_difficile
      ? "longueur"
      : reglage.mots_difficiles.some((m) => m.trim() && q.includes(m.toLocaleLowerCase("fr")))
        ? "mot"
        : nbPiecesJointes > 1
          ? "pieces"
          : null;
  const difficile = motif !== null;
  return {
    modele: difficile ? reglage.modele_difficile : reglage.modele_courant,
    effort: difficile ? reglage.effort_difficile : reglage.effort_courant,
    reflexion: difficile ? reglage.reflexion_difficile : reglage.reflexion_courant,
    difficile,
    motif,
  };
}
