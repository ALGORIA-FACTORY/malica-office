/**
 * Le statut d'une pièce envoyée, un mot et une couleur, le même des deux côtés
 * (« Malica sans blocage », spec §2, maquette validée le 28 octobre 2026).
 *
 * La PME lit : Envoyée · Vue · Retour · Prise en charge (et, avant l'envoi,
 * Mon espace · À envoyer · Gardée). Le comptable lit : Reçue · Vue ·
 * Retournée · Corrigée · Validée · Forcée. Aucune écriture n'est montrée à la
 * PME, et rien ne lui demande de confirmer.
 *
 * UN SEUL CIRCUIT, DEUX FOIS (lot 4) : siège → propriétaire → comptable. Le
 * propriétaire est au siège ce que le comptable est au propriétaire : côté
 * siège, « Envoyée au propriétaire · Vue par {prénom} · Retour de {prénom} » ;
 * côté propriétaire, la pièce d'un siège est « Reçue » jusqu'à ce qu'il
 * l'ouvre, « Corrigée » si le siège l'a corrigée depuis, « Retournée à
 * {prénom} » quand il la lui a rendue. Les mêmes mots, les mêmes teintes.
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

/**
 * Ce que la société sait du passage siège → propriétaire
 * (`app.circuit_de_la_piece`), et de quel côté est la personne qui regarde.
 */
export interface CircuitInterne {
  /** La personne reçoit les pièces des sièges (le propriétaire). */
  recoit: boolean;
  /** Le dernier fait du passage, s'il y en a un. */
  dernier: "envoyee" | "retournee" | "rappelee" | null;
  /** Le dernier envoi au propriétaire (ou renvoi après un retour). */
  envoyeeLe: string | null;
  /** La dernière ouverture par un propriétaire, et son prénom. */
  vueLe: string | null;
  vuePar: string | null;
  /** Le dernier retour du propriétaire au siège, et son prénom. */
  retourneeLe: string | null;
  retourPar: string | null;
  /** La dernière correction de l'auteur après son dernier envoi. */
  corrigeeLe: string | null;
  /** Le prénom de l'auteur de la pièce. */
  auteur: string | null;
  /** La personne qui regarde en est l'auteur : elle seule la déplace. */
  mienne: boolean;
}

export type StatutPme =
  | "mon_espace"
  | "a_envoyer"
  | "gardee"
  | "envoyee"
  | "vue"
  | "retour"
  | "prise_en_charge"
  // Le propriétaire, pour la pièce d'un siège.
  | "recue"
  | "corrigee"
  | "retournee";

/**
 * Chez qui en est la pièce, pour nommer l'autre : « Envoyée au propriétaire »,
 * « Vue par Amel », « Retour de {cabinet} », « Retournée à Sami ».
 */
export type ChezQui = "proprietaire" | "cabinet" | "siege";

export interface StatutDuCircuit {
  statut: StatutPme;
  /** `null` : rien n'est parti, personne d'autre à nommer. */
  chez: ChezQui | null;
  /**
   * Le prénom de l'autre, quand la base le sait (passage siège ↔
   * propriétaire). Côté comptable, l'écran nomme le cabinet qu'il connaît.
   */
  qui: string | null;
}

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
  recue: "am",
  corrigee: "am",
  retournee: "az",
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

/** Ce qu'il faut d'une pièce pour dire son statut côté PME. */
export interface FaitsDeLaPiece {
  vis: Visibility;
  status: PieceStatus | string;
  gardeeLe?: string | null;
  suivi?: SuiviDEnvoi | null;
  circuit?: CircuitInterne | null;
  /** Un reçu ou un justificatif, qui suit sa pièce (`PieceLue.accompagne`). */
  accompagne?: boolean | null;
}

const rien = (statut: StatutPme): StatutDuCircuit => ({ statut, chez: null, qui: null });

/**
 * Le statut côté PME — le siège qui l'a faite, ou le propriétaire —, et chez
 * qui elle est. La seule dérivation : la liste, la fiche, l'accueil, la file
 * des pièces reçues la lisent toutes ici.
 */
export function statutDuCircuit(p: FaitsDeLaPiece): StatutDuCircuit {
  const c = p.circuit ?? null;
  if (p.vis === "personnel") return rien("mon_espace");

  if (p.vis === "entite") {
    if (c?.recoit) {
      // Le propriétaire, pour la pièce qu'un siège lui a envoyée.
      if (c.dernier === "envoyee") {
        if (!apres(c.vueLe, c.envoyeeLe)) return rien("recue");
        if (c.corrigeeLe && Date.parse(c.corrigeeLe) > Date.parse(c.vueLe!))
          return rien("corrigee");
      }
      if (c.dernier === "retournee") return { statut: "retournee", chez: "siege", qui: c.auteur };
      return rien(p.gardeeLe ? "gardee" : "a_envoyer");
    }
    // Le siège : son passage chez le propriétaire.
    if (c?.dernier === "retournee")
      return { statut: "retour", chez: "proprietaire", qui: c.retourPar };
    if (c?.dernier === "envoyee")
      return apres(c.vueLe, c.envoyeeLe)
        ? { statut: "vue", chez: "proprietaire", qui: c.vuePar }
        : { statut: "envoyee", chez: "proprietaire", qui: null };
    // « Garder » est la décision du propriétaire, sur l'envoi au comptable :
    // elle ne retient pas le siège, dont l'étape est d'envoyer au propriétaire.
    if (c && !c.recoit) return rien("a_envoyer");
    return rien(p.gardeeLe ? "gardee" : "a_envoyer");
  }

  // Chez le comptable.
  if (p.suivi?.prise) return { statut: "prise_en_charge", chez: "cabinet", qui: null };
  if (p.status === "retournee") return { statut: "retour", chez: "cabinet", qui: null };
  // Le siège ne suit que SON passage : le propriétaire a reçu, et l'a fait suivre.
  if (c && !c.recoit && c.envoyeeLe)
    return apres(c.vueLe, c.envoyeeLe)
      ? { statut: "vue", chez: "proprietaire", qui: c.vuePar }
      : { statut: "envoyee", chez: "proprietaire", qui: null };
  const s = p.suivi;
  if (s?.vueLe && apres(s.vueLe, s.envoyeeLe)) return { statut: "vue", chez: "cabinet", qui: null };
  return { statut: "envoyee", chez: "cabinet", qui: null };
}

/** Le mot seul (la teinte, un filtre, un compte). */
export function statutPme(p: FaitsDeLaPiece): StatutPme {
  return statutDuCircuit(p).statut;
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
