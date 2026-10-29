/**
 * Ce que la fiche d'une pièce (côté PME) affirme, dérivé en un seul endroit
 * pour qu'elle ne se contredise jamais.
 *
 * Depuis « Malica sans blocage » (lot 5), la PME ne voit aucune écriture et
 * ne confirme rien : la fiche dit où la pièce en est chez le cabinet —
 * Envoyée, Vue, Prise en charge —, d'après les faits que la base garde
 * (`app.suivi_de_la_piece`). Le parcours « Lue · Confirmée · Comptée » et sa
 * pastille sont partis avec la confirmation du client.
 */
import type { Visibility } from "@malica/socle/ports/repositories";
import type { SuiviDEnvoi } from "@malica/socle/statut-d-envoi";

/** Une étape de « Où elle en est » (maquette « Fiche PME sans écriture »). */
export interface EtapeDuSuivi {
  cle: "envoyee" | "vue" | "prise_en_charge";
  /** Quand elle a eu lieu ; `null` : à venir. */
  le: string | null;
}

/**
 * Où en est la pièce chez le cabinet : envoyée, vue, prise en charge — dans
 * cet ordre, chacune avec son heure, ou à venir. Une vue d'AVANT le dernier
 * envoi (la pièce est revenue, puis repartie) ne compte plus.
 */
export function ouEnEstLaPiece(suivi: SuiviDEnvoi | null): EtapeDuSuivi[] {
  const envoyee = suivi?.envoyeeLe ?? null;
  const vue =
    suivi?.vueLe && (envoyee === null || Date.parse(suivi.vueLe) >= Date.parse(envoyee))
      ? suivi.vueLe
      : null;
  return [
    { cle: "envoyee", le: envoyee },
    { cle: "vue", le: vue },
    { cle: "prise_en_charge", le: suivi?.prise ? suivi.priseLe : null },
  ];
}

/**
 * La pièce est entre les mains du cabinet : partagée. C'est là seulement
 * qu'une suppression se DEMANDE — `piece_demander` refuse toute autre pièce,
 * et un bouton qui ne peut qu'échouer ne se montre pas.
 */
export function partageeAvecLeCabinet(vis: Visibility): boolean {
  return vis === "partage";
}

/**
 * La note sur une demande de suppression, à montrer ou non.
 *
 * Une pièce rappelée au privé peut garder une vieille demande en attente :
 * ce n'est plus à la comptabilité d'accorder quoi que ce soit, et la note
 * cacherait le « Supprimer » ordinaire. Hors partage, rien.
 */
export function noteDeSuppression(
  fait: string | null,
  vis: Visibility,
): "demandee" | "refusee" | null {
  if (!partageeAvecLeCabinet(vis)) return null;
  return fait === "demandee" || fait === "refusee" ? fait : null;
}

/**
 * Ce que dit l'étiquette d'une ligne lue (maquette « C », 25 octobre 2026) :
 * la confiance du jugement décide ; tant qu'elle n'est pas connue, on ne dit
 * rien de faux (« inconnue » : l'écran propose seulement de voir la zone
 * source). La PME ne confirme rien : aucune ligne ne se dit « confirmée ».
 */
export type EtiquetteDeLecture = "aVerifier" | "source" | "inconnue";

export function etiquetteDeLecture(ligne: {
  confianceConnue: boolean;
  aVerifier: boolean;
}): EtiquetteDeLecture {
  if (!ligne.confianceConnue) return "inconnue";
  return ligne.aVerifier ? "aVerifier" : "source";
}

const JOUR_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La date à enregistrer depuis le champ « Date », ou `null` s'il n'y a rien à
 * écrire.
 *
 * Audit du 25 octobre 2026 : le jour du scan proposé ne s'enregistrait que si
 * on le CHANGEAIT — garder la date proposée n'écrivait rien, et la pièce
 * restait « date à indiquer ». La valeur affichée est donc enregistrable
 * telle quelle (en quittant le champ), sauf si c'est déjà celle qui est
 * enregistrée ou celle qui est en train de l'être. Une saisie incomplète
 * (chaîne vide d'un champ `date`) n'écrit rien.
 */
export function dateAEnregistrer(
  saisie: string,
  enregistree: string | null,
  enCours: string | null,
): string | null {
  if (!JOUR_ISO.test(saisie)) return null;
  if (saisie === enregistree || saisie === enCours) return null;
  return saisie;
}
