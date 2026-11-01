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
 * dirigeant de PME, et ils contredisent une règle du produit : Malica ne
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
import { remplirLeGabarit } from "@malica/socle/gabarit";
import { lireUnRefus } from "@malica/socle/refus-a-dire";

import { localeRangee } from "@/i18n";
import { dictionnaireCharge, DICTIONNAIRE_DE_REPLI } from "@/i18n/dictionnaires";

import { noterAuJournal } from "./journal-atelier";
import { ErreurApi, ErreurReseau } from "./transport/erreurs";

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
  /*
   * 27 octobre 2026, Wissem : « pas d'erreur à l'écran, tout dans le journal,
   * pour que tu corriges ». Une réponse 5xx de l'API n'est pas un refus rédigé
   * pour la personne : c'est une panne — la suppression bloquée par R7 en
   * était une, et l'écran l'affichait en texte brut, sans que personne ne la
   * relise. Elle part au journal, et l'écran dit seulement la phrase prévue.
   * Les refus métier (4xx) restent affichés : ils disent quoi faire.
   */
  if (raison instanceof ErreurApi && raison.statut >= 500) {
    noterAuJournal(ou, raison);
    return defaut;
  }
  if (vientDeNous(raison)) {
    // Un refus de la base peut lever une CLÉ du dictionnaire (« refus.licence.
    // transmission ») plutôt qu'une phrase française : on la dit dans la
    // langue de la personne, avec les valeurs qu'elle cite.
    const dict = (dictionnaireCharge(localeRangee()) ?? DICTIONNAIRE_DE_REPLI) as Record<
      string,
      string
    >;
    const { cle, valeurs } = lireUnRefus(raison.message);
    const gabarit = dict[cle];
    if (gabarit === undefined) return raison.message;
    return remplirLeGabarit(gabarit, valeurs);
  }
  // Pas de réseau n'est pas une panne : on le dit, sans l'inscrire au journal —
  // le journal ne dirait rien qu'on ne sache déjà.
  if (raison instanceof ErreurReseau)
    return (dictionnaireCharge(localeRangee()) ?? DICTIONNAIRE_DE_REPLI)["common.horsLigne"];
  noterAuJournal(ou, raison);
  return defaut;
}

/**
 * L'API a répondu que l'objet n'existe pas — ou plus (404). Une pièce
 * effacée par une suppression accordée en est le cas courant : ce n'est pas
 * une panne, et l'écran le dit autrement.
 */
export function estIntrouvable(raison: unknown): boolean {
  return raison instanceof ErreurApi && raison.statut === 404;
}
