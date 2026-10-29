/**
 * Le statut d'une pièce envoyée, un mot et une couleur, le même des deux côtés
 * (« Malica sans blocage », spec §2, maquette validée le 28 octobre 2026).
 *
 * La PME lit : Envoyée · Vue · Retour · Prise en charge (et, avant l'envoi,
 * Mon espace · À envoyer · Gardée). Le comptable lit : Reçue · Vue ·
 * Retournée · Corrigée · Validée · Forcée. Aucune écriture n'est montrée à la
 * PME, et rien ne lui demande de confirmer.
 *
 * Les FAITS viennent de la base (`app.suivi_de_la_piece`) ; le mot se dérive
 * ici, une fois, pour l'API qui trie la file du cabinet et pour les deux
 * écrans. Deux dérivations finiraient par se contredire — c'est exactement
 * ce que l'audit du 25 octobre avait relevé entre la pastille et le parcours.
 */
import type { PieceStatus, Visibility } from "./ports/repositories.ts";

/** Ce que la base sait du chemin d'une pièce envoyée au cabinet. */
export interface SuiviDEnvoi {
  /** Le dernier envoi : la transmission, ou le dernier renvoi après un retour. */
  envoyeeLe: string | null;
  /** La dernière ouverture par le cabinet, et le nom du cabinet. */
  vueLe: string | null;
  vuePar: string | null;
  /** La dernière correction du client après l'envoi (précision, photo reprise). */
  corrigeeLe: string | null;
  /** La prise en charge de l'écriture vivante par le cabinet. */
  priseLe: string | null;
  prise: "validee" | "forcee" | null;
  /** Le comptable qui l'a prise en charge — jamais rendu au client. */
  prisePar: string | null;
}

export type StatutPme =
  | "mon_espace"
  | "a_envoyer"
  | "gardee"
  | "envoyee"
  | "vue"
  | "retour"
  | "prise_en_charge";

export type StatutCabinet = "recue" | "vue" | "corrigee" | "retournee" | "validee" | "forcee";

/**
 * La couleur, et seulement elle : gris rien à faire, ambre à vous, bleu chez
 * l'autre, vert pris en charge. Les noms sont ceux des feuilles de style
 * (`.f-etat.am`, `.pt[data-ton="az"]`…) : un seul vocabulaire de teintes.
 */
export type TonDuStatut = "neutre" | "am" | "az" | "ok";

export const TON_PME: Readonly<Record<StatutPme, TonDuStatut>> = {
  mon_espace: "neutre",
  a_envoyer: "am",
  gardee: "neutre",
  envoyee: "az",
  vue: "az",
  retour: "am",
  prise_en_charge: "ok",
};

export const TON_CABINET: Readonly<Record<StatutCabinet, TonDuStatut>> = {
  recue: "am",
  vue: "am",
  corrigee: "am",
  retournee: "az",
  validee: "ok",
  forcee: "ok",
};

/** Ce qui attend le comptable : à lui de valider, forcer ou retourner. */
export const A_TRAITER: ReadonlySet<StatutCabinet> = new Set(["recue", "vue", "corrigee"]);

const apres = (a: string | null, b: string | null): boolean =>
  a !== null && (b === null || Date.parse(a) >= Date.parse(b));

/** Le plus récent des deux instants, ou celui qui existe. */
const plusTard = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : Date.parse(a) >= Date.parse(b) ? a : b;

/** Le statut côté PME (le propriétaire, ou le siège qui l'a faite). */
export function statutPme(p: {
  vis: Visibility;
  status: PieceStatus | string;
  gardeeLe?: string | null;
  suivi: SuiviDEnvoi | null;
}): StatutPme {
  if (p.vis === "personnel") return "mon_espace";
  if (p.vis === "entite") return p.gardeeLe ? "gardee" : "a_envoyer";
  if (p.suivi?.prise) return "prise_en_charge";
  if (p.status === "retournee") return "retour";
  const s = p.suivi;
  if (s?.vueLe && apres(s.vueLe, s.envoyeeLe)) return "vue";
  return "envoyee";
}

/**
 * Le statut côté cabinet.
 *
 * « Corrigée » : le client a corrigé après l'envoi, et le cabinet ne l'a pas
 * rouverte depuis. « Vue » : ouverte depuis le dernier envoi et la dernière
 * correction. Une pièce renvoyée sans rien changer redevient « Reçue ».
 */
export function statutCabinet(p: {
  status: PieceStatus | string;
  suivi: SuiviDEnvoi | null;
}): StatutCabinet {
  const s = p.suivi;
  if (s?.prise) return s.prise;
  if (p.status === "retournee") return "retournee";
  if (s?.vueLe && apres(s.vueLe, plusTard(s.envoyeeLe, s.corrigeeLe))) return "vue";
  if (s?.corrigeeLe && (s.vueLe === null || Date.parse(s.corrigeeLe) > Date.parse(s.vueLe)))
    return "corrigee";
  return "recue";
}
