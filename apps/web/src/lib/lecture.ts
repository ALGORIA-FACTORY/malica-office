/**
 * La lecture des pièces, vue des écrans — un seul endroit.
 *
 * 24 octobre 2026, parcours validé par Wissem : la lecture se fait tout de
 * suite ou plus tard, pour plusieurs pièces choisies, et « rien ne dit que la
 * lecture casse » ne doit plus être vrai. L'accueil, la bibliothèque, l'écran
 * « À lire », la capture et la fiche lisent tous l'issue d'une pièce par
 * `issueDeLecture` (Socle) et ses mots par les tables ci-dessous — trois
 * copies d'une règle divergent au premier changement.
 */
import {
  demandeUnGeste,
  issueDeLecture,
  type CodeDeLecture,
  type IssueDeLecture,
} from "@malica/socle/issue-de-lecture";
import type { MessageKey } from "@malica/socle/messages";
import type { PieceLue } from "@malica/socle/ports/repositories";

/**
 * Le rythme auquel un écran redemande l'état d'une lecture qui tourne.
 * Réglage d'affichage, pas règle métier (R4) : un seul, pour tous les écrans.
 */
export const SUIVI_DE_LECTURE_MS = 3_000;

const plusRecenteDAbord = (x: PieceLue, y: PieceLue) => y.createdAt.localeCompare(x.createdAt);

/**
 * À lire = capturée, jamais demandée (ou rien en cours), pas gardée pour soi
 * (la question a été tranchée) et pas refusée (un refus a son motif, ailleurs).
 * Une pièce dont la lecture a ÉCHOUÉ n'est pas « à lire » : elle attend un
 * geste précis, et `piecesEnEchec` la porte. La plus récente d'abord.
 */
/**
 * Ce qui attend la personne : lu, proposé, ou renvoyé par le cabinet. La
 * rangée « Ce que j'ai préparé » de l'accueil et le filtre « À vérifier » de
 * la bibliothèque, où mène son « Tout voir », lisent cette seule règle.
 */
export function attendLaPersonne(p: Pick<PieceLue, "status">): boolean {
  return p.status === "lue" || p.status === "proposee" || p.status === "retournee";
}

export function piecesALire(pieces: readonly PieceLue[]): PieceLue[] {
  return pieces
    .filter((p) => !p.gardeeLe && issueDeLecture(p).kind === "a_lire")
    .sort(plusRecenteDAbord);
}

/** Les pièces dont la lecture a échoué et qui attendent un geste. */
export function piecesEnEchec(pieces: readonly PieceLue[]): PieceLue[] {
  return pieces
    .filter((p) => !p.gardeeLe && demandeUnGeste(issueDeLecture(p)))
    .sort(plusRecenteDAbord);
}

/** Une lecture tourne encore, ou attend sa reprise : l'écran redemande. */
export function lectureEnSuspens(p: PieceLue): boolean {
  const k = issueDeLecture(p).kind;
  return k === "en_cours" || k === "attente";
}

/** La raison, en une ligne : sous le nom de la pièce, dans une liste. */
const RAISON_COURTE: Record<CodeDeLecture, MessageKey> = {
  "lecture.illisible": "pme.lecture.court.illisible",
  "lecture.vide": "pme.lecture.court.vide",
  "lecture.trop_dense": "pme.lecture.court.tropDense",
  "lecture.trop_longue": "pme.lecture.court.tropLongue",
};

/** La raison, en entier, avec le geste à faire : sur la fiche. */
export const RAISON_LONGUE: Record<CodeDeLecture, MessageKey> = {
  "lecture.illisible": "pme.lire.illisible",
  "lecture.vide": "pme.lire.vide",
  "lecture.trop_dense": "pme.lire.tropDense",
  "lecture.trop_longue": "pme.lire.tropLongue",
};

/**
 * Comment une issue se montre dans une ligne : son ton (la couleur, toujours
 * doublée d'un mot), son mot, sa raison courte, et le geste proposé.
 *
 * Le `switch` est exhaustif : un état ajouté au Socle sans présentation ne
 * compile pas — c'est ainsi qu'un refus s'affichait « en cours » (revue du
 * 24 octobre 2026). Le refus porte sa raison par `libelleDuRefus`, à part :
 * ce n'est pas une clé, c'est une phrase qui dépend du motif.
 */
export interface PresentationDeLecture {
  ton: "ok" | "ko" | "att" | "neutre";
  mot: MessageKey;
  raison: MessageKey | null;
  geste: "relire" | "lire" | null;
}

export function presentation(i: IssueDeLecture): PresentationDeLecture {
  switch (i.kind) {
    case "lue":
      return { ton: "ok", mot: "pme.capture.lire.lue", raison: null, geste: null };
    case "en_cours":
      return { ton: "neutre", mot: "pme.capture.travail.en_cours", raison: null, geste: null };
    case "attente":
      return { ton: "att", mot: "pme.lecture.enAttente", raison: raisonCourte(i), geste: null };
    case "a_reprendre":
    case "echec":
      return { ton: "ko", mot: "pme.lecture.pasLue", raison: raisonCourte(i), geste: "relire" };
    case "refusee":
      return { ton: "ko", mot: "pme.refus.titre", raison: null, geste: null };
    case "a_lire":
      return { ton: "neutre", mot: "pme.refus.attente", raison: null, geste: "lire" };
    default: {
      const jamais: never = i;
      return jamais;
    }
  }
}

/** La ligne d'état d'une pièce non lue : sa raison courte, ou `null`. */
export function raisonCourte(i: IssueDeLecture): MessageKey | null {
  switch (i.kind) {
    case "a_reprendre":
      return RAISON_COURTE[i.code];
    case "echec":
      return i.code ? RAISON_COURTE[i.code] : "pme.lecture.court.echec";
    case "attente":
      return "pme.lecture.court.attente";
    default:
      return null;
  }
}
