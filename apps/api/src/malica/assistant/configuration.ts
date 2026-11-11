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
import type { RegleDeLaGarde } from "./garde.ts";

type Effort = "low" | "medium" | "high";
type Reflexion = "disabled" | "between_tools" | "adaptive";

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

/**
 * Le plafond PROPRE à l'assistant (décision du dirigeant, 8 novembre 2026 :
 * 150 $ par mois, livré par migration, réglable dans la tour) et ce qu'il en
 * a déjà dépensé sur Claude. Atteint, l'assistant passe au repli de la chaîne
 * sans appeler Claude ; la lecture des pièces n'en est pas touchée.
 */
interface PlafondDeLAssistant {
  plafond: number;
  periode: "jour" | "mois";
  depense: number;
  epuise: boolean;
}

/** Lu en base (`plateforme.assistant_relectures`). */
type ModeDeRelecture = "annoncer" | "retenir";

export interface ConfigurationDeLAssistant {
  consigne: { id: string; texte: string; decide_le: string };
  reglage: ReglageDeLAssistant;
  tarifs: TarifDeModele[];
  plafond: PlafondDeLAssistant;
  /** Ce qui rend un chiffre liant ; `null` : la garde juge tout chiffre. */
  garde: RegleDeLaGarde | null;
  /**
   * Ce que devient une réponse que le cabinet doit relire (décision du
   * dirigeant, 11 novembre 2026) : `annoncer` l'affiche marquée « à confirmer »
   * et l'envoie au cabinet ; `retenir` ne montre que le message de relecture.
   */
  relecture: ModeDeRelecture;
  /**
   * Quand le corpus ne répond pas (M-9) : `marquer` laisse Malica répondre, ses
   * chiffres marqués « non vérifié » ; `retirer` garde la règle stricte.
   */
  sansTexte: "marquer" | "retirer";
  /**
   * Les unités de taux et de durée (« % », « jours »…) qu'un chiffre de mémoire
   * peut porter pour partir marqué. Tout autre chiffre sans source est retiré.
   */
  unitesMarquables: string[];
  /**
   * La recherche sur internet : le type de l'outil du fournisseur et le nombre
   * de recherches par réponse, lus en base. `null` : coupée, ou réglage absent
   * ou incomplet — l'outil n'est alors pas offert au modèle.
   */
  web: { outil: string; recherchesMax: number } | null;
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
    plafond: lirePlafond(c.plafond),
    garde: lireLaGarde(c.garde),
    // Absent ou illisible : on retient, comme avant — le manque retombe du côté prudent.
    relecture: c.relecture === "annoncer" ? "annoncer" : "retenir",
    sansTexte: (c as { sans_texte?: unknown }).sans_texte === "marquer" ? "marquer" : "retirer",
    unitesMarquables: ((c as { unites_marquables?: unknown }).unites_marquables instanceof Array
      ? ((c as { unites_marquables: unknown[] }).unites_marquables as unknown[])
      : []
    ).filter((u): u is string => typeof u === "string" && u.trim() !== ""),
    web: lireLeWeb((c as { web?: unknown }).web),
  };
}

/** Le réglage de la recherche sur internet. Coupée, absente ou incomplète : `null`. */
function lireLeWeb(brut: unknown): ConfigurationDeLAssistant["web"] {
  const w = brut as { active?: unknown; outil?: unknown; recherches_max?: unknown } | null;
  const max = Number(w?.recherches_max);
  if (w?.active !== true || typeof w.outil !== "string" || !w.outil.trim()) return null;
  if (!Number.isInteger(max) || max < 1) return null;
  return { outil: w.outil.trim(), recherchesMax: max };
}

/** La règle de la garde. Absente ou illisible : `null`, et la garde reste stricte. */
function lireLaGarde(brut: unknown): RegleDeLaGarde | null {
  const g = brut as Partial<Record<keyof RegleDeLaGarde, unknown>> | null | undefined;
  const marques = Array.isArray(g?.marques_liantes)
    ? g.marques_liantes.filter((m): m is string => typeof m === "string" && m.trim() !== "")
    : [];
  const seuil = Number(g?.entier_liant_des);
  if (marques.length === 0 || !Number.isInteger(seuil) || seuil < 1) return null;
  return { marques_liantes: marques, entier_liant_des: seuil };
}

/**
 * Le plafond lu en base. Absent ou illisible, c'est une panne qui se dit
 * (R4) : un assistant sans plafond dépenserait sans borne sur le budget de la
 * lecture des pièces.
 */
function lirePlafond(brut: unknown): PlafondDeLAssistant {
  const p = brut as Partial<Record<keyof PlafondDeLAssistant, unknown>> | null | undefined;
  const plafond = Number(p?.plafond);
  const depense = Number(p?.depense);
  if (!p || !Number.isFinite(plafond) || !Number.isFinite(depense)) {
    throw new Error("assistant.plafond_absent");
  }
  if (p.periode !== "jour" && p.periode !== "mois") throw new Error("assistant.plafond_absent");
  return { plafond, periode: p.periode, depense, epuise: p.epuise === true || depense >= plafond };
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
