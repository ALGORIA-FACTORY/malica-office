/**
 * Ce qu'on montre d'une erreur, et ce qu'on garde pour l'atelier.
 *
 * ============================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * L'utilisateur a vu ceci, en anglais, au milieu d'un écran français :
 *
 *   Cannot transfer object of unsupported type.
 *
 * Puis, une autre fois, un tableau JSON de validation. Ces textes viennent
 * d'un moteur ou d'une bibliothèque ; ils ne veulent rien dire pour un
 * dirigeant de PME, et ils contredisent une règle du produit : Regalica ne
 * montre aucun détail technique.
 *
 * Quatorze écrans affichaient `e.message` tel quel.
 *
 * ============================================ POURQUOI PAS TOUT REMPLACER
 *
 * Parce que certains de ces messages sont PRÉCIEUX. Quand l'API refuse —
 * « Ce matricule appartient déjà à un autre dossier », « La période est
 * close » —, la phrase est écrite par nous, dans la langue du client, et elle
 * dit exactement quoi faire. L'écraser par « une erreur est survenue » ferait
 * perdre l'information la plus utile de l'écran.
 *
 * ============================================== D'OÙ VIENT LE MESSAGE ?
 *
 * On tranche par l'ORIGINE, jamais par le texte. Deviner « est-ce du français
 * ou du jargon ? » à partir des caractères serait une heuristique, et elle se
 * tromperait un jour sur un nom propre ou un code de compte.
 *
 *   ErreurApi          → notre API. On l'affiche : c'est notre phrase.
 *   tout le reste      → origine inconnue. Phrase humaine à l'écran, et le
 *                        message d'origine part au journal de l'atelier.
 *
 * Rien n'est donc perdu : ce que l'utilisateur ne voit plus, le poste le
 * reçoit avec sa pile d'appels.
 */
import { ErreurApi } from "../verticals/regalica-office/adapters/http/rpc";

import { noterAuJournal } from "./journal-atelier";

/** Une erreur écrite par nous, destinée à être lue par le client. */
export function vientDeNous(raison: unknown): raison is Error {
  return raison instanceof ErreurApi;
}

/**
 * Le texte à afficher, et le journal alimenté au passage.
 *
 * `ou` situe l'erreur — « pièce : lecture », « coffre : suppression ». C'est
 * ce qui permet, en lisant le journal, de savoir quel geste l'a produite.
 */
export function texteDeLErreur(raison: unknown, ou: string, defaut: string): string {
  if (vientDeNous(raison)) return raison.message;
  noterAuJournal(ou, raison);
  return defaut;
}
