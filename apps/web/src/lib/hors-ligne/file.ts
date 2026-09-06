/**
 * La file hors ligne — ce qui attend de partir, et où chaque élément en est.
 *
 * ============================================================== POURQUOI
 *
 * Le dirigeant photographie un reçu dans un magasin sans réseau. Sans file,
 * la photo échoue et il recommence plus tard — ou n'y pense plus. Avec une
 * file, la photo est rangée AVANT tout appel réseau, et part toute seule au
 * retour du réseau. Rien n'est perdu, rien n'est à refaire.
 *
 * ============================================================= LES ÉTATS
 *
 *   a_envoyer          rangée sur l'appareil, rien n'est parti
 *   enregistree        l'API a la ligne : `capture.enregistrer` a rendu l'identifiant
 *   deposee            l'API a les octets
 *   lecture_demandee   la lecture est lancée — l'élément est purgé aussitôt
 *   echec_definitif    l'API a refusé (4xx lisible) : on garde, on montre, la personne décide
 *
 * Chaque pas est rejouable, parce que le serveur l'est : `enregistrer` avec
 * la même clé rend le même identifiant, et redéposer les octets remplace.
 * Une application tuée entre deux pas reprend au pas persisté, sans doublon.
 *
 * Ce module est pur : la transition est une fonction, le vidage est ailleurs.
 */

export type EtatElement =
  "a_envoyer" | "enregistree" | "deposee" | "lecture_demandee" | "echec_definitif";

export interface ElementDeFile {
  /** La clé d'idempotence, générée AVANT la persistance. C'est aussi l'identité locale. */
  cle: string;
  tenantId: string;
  entityId: string | null;
  source: "photo" | "pdf";
  /** Personnel ou partagé — décidé par l'écran, jamais ici. */
  vis: "personnel" | "partage";
  contentType: string;
  nomFichier: string;
  /** En octets — pour le plafond, et pour dire « 1,2 Mo » à l'écran. */
  taille: number;
  /** ISO. Décide de l'ordre d'envoi, et du mois affiché. */
  creeLe: string;
  etat: EtatElement;
  pieceId: string | null;
  tentatives: number;
  /** ISO, ou `null` : dès que possible. */
  prochainEssaiLe: string | null;
  derniereErreur: string | null;
}

export type NouvelElement = Pick<
  ElementDeFile,
  "cle" | "tenantId" | "entityId" | "source" | "vis" | "contentType" | "nomFichier" | "taille"
>;

export type Evenement =
  | { type: "enregistree"; pieceId: string }
  | { type: "deposee" }
  | { type: "lecture_demandee" }
  | { type: "echec"; nature: "reseau" | "serveur" | "refus"; message: string }
  | { type: "reessayer" };

/** Cinquante éléments, deux cent cinquante mégaoctets : au-delà, on le dit au lieu de jeter. */
export const PLAFOND_ELEMENTS = 50;
export const PLAFOND_OCTETS = 250 * 1024 * 1024;

/** Le délai avant un nouvel essai : 1 s, 2 s, 4 s… plafonné à cinq minutes. */
export function delaiAvantEssai(tentatives: number): number {
  return Math.min(2 ** Math.max(0, tentatives - 1) * 1000, 5 * 60 * 1000);
}

export function nouvelElement(entree: NouvelElement, maintenant: number): ElementDeFile {
  return {
    ...entree,
    creeLe: new Date(maintenant).toISOString(),
    etat: "a_envoyer",
    pieceId: null,
    tentatives: 0,
    prochainEssaiLe: null,
    derniereErreur: null,
  };
}

/**
 * La transition. Un événement qui ne s'applique pas à l'état rend l'élément
 * tel quel : la machine ne saute pas d'états, et un événement en retard ne
 * fait pas reculer.
 */
export function transition(e: ElementDeFile, evt: Evenement, maintenant: number): ElementDeFile {
  switch (evt.type) {
    case "enregistree":
      if (e.etat !== "a_envoyer") return e;
      return { ...e, etat: "enregistree", pieceId: evt.pieceId, derniereErreur: null };
    case "deposee":
      if (e.etat !== "enregistree") return e;
      return { ...e, etat: "deposee", derniereErreur: null };
    case "lecture_demandee":
      if (e.etat !== "deposee") return e;
      return { ...e, etat: "lecture_demandee", derniereErreur: null };
    case "echec": {
      if (e.etat === "lecture_demandee" || e.etat === "echec_definitif") return e;
      if (evt.nature === "refus") {
        return {
          ...e,
          etat: "echec_definitif",
          derniereErreur: evt.message,
          prochainEssaiLe: null,
        };
      }
      const tentatives = e.tentatives + 1;
      return {
        ...e,
        tentatives,
        derniereErreur: evt.message,
        prochainEssaiLe: new Date(maintenant + delaiAvantEssai(tentatives)).toISOString(),
      };
    }
    case "reessayer":
      if (e.etat !== "echec_definitif") return { ...e, tentatives: 0, prochainEssaiLe: null };
      return {
        ...e,
        etat: "a_envoyer",
        tentatives: 0,
        prochainEssaiLe: null,
        derniereErreur: null,
      };
  }
}

/** Vrai si l'élément a quelque chose à faire maintenant. */
export function estADeclencher(e: ElementDeFile, maintenant: number): boolean {
  if (e.etat === "echec_definitif" || e.etat === "lecture_demandee") return false;
  return e.prochainEssaiLe === null || Date.parse(e.prochainEssaiLe) <= maintenant;
}

/** Vrai si la pièce existe déjà côté API — l'écran peut l'ouvrir. */
export function estArrivee(e: ElementDeFile): boolean {
  return e.pieceId !== null && e.etat !== "a_envoyer";
}
