/**
 * Ce qu'on montre d'une erreur, et ce qu'on garde pour le journal.
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
 * ================================================== LA RÈGLE, ET UNE SEULE
 *
 * 6 novembre 2026, le dirigeant : « aucun message d'erreur technique n'arrive
 * à l'écran. Une panne montre une phrase humaine, traduite ; le détail va au
 * journal, en base. »
 *
 * Un refus 4xx de notre API qui n'était pas une clé du dictionnaire passait
 * encore « tel quel » : un message de base, de pilote, un nom renvoyé en écho
 * (HTML compris) atteignaient l'écran (audit du 6 novembre, web constat 2).
 * On ne devine plus « est-ce une phrase écrite pour la personne ? » :
 *
 *   ErreurReseau                  → « pas de connexion », sans journal ;
 *   ErreurApi 4xx, CLÉ connue     → la phrase du dictionnaire, dans la langue
 *                                   de la personne, avec les valeurs citées ;
 *   tout le reste                 → la phrase prévue par l'écran, suivie d'une
 *                                   RÉFÉRENCE (« réf. 7F3A21C9 ») ; le détail
 *                                   part au journal en base, sous la même
 *                                   référence — c'est elle que la personne
 *                                   cite, et elle qui retrouve la ligne.
 *
 * Rien n'est donc perdu : ce que l'utilisateur ne voit plus, le journal le
 * garde avec sa pile d'appels. `__tests__/aucune-erreur-brute-a-l-ecran.test.ts`
 * empêche qu'un écran contourne ce chemin.
 */
import { remplirLeGabarit } from "@malica/socle/gabarit";
import { lireUnRefus } from "@malica/socle/refus-a-dire";

import { localeRangee } from "@/i18n";
import { dictionnaireCharge, dictionnaireDeRepli } from "@/i18n/dictionnaires";

import { noterAuJournal } from "./journal-atelier";
import { ErreurApi, ErreurReseau } from "./transport/erreurs";

/** Une erreur écrite par nous, destinée à être lue par le client. */
export function vientDeNous(raison: unknown): raison is Error {
  return raison instanceof ErreurApi;
}

/**
 * Le dictionnaire de la personne. Dire une panne ne doit jamais en lever une
 * seconde : si la langue rangée ne se lit pas, le français la remplace.
 */
function dictionnaire(): Record<string, string> {
  let charge;
  try {
    charge = dictionnaireCharge(localeRangee());
  } catch {
    charge = undefined;
  }
  // Le français n'est plus dans le paquet initial (`i18n/dictionnaires.ts`),
  // mais l'écran ne s'hydrate qu'une fois une langue chargée : le dictionnaire
  // vide n'est qu'une garde : on y dit la clé plutôt que de lever.
  return (charge ?? dictionnaireDeRepli() ?? {}) as Record<string, string>;
}

/** Une référence courte, à citer : huit chiffres hexadécimaux. */
function nouvelleReference(): string {
  const octets = new Uint8Array(4);
  globalThis.crypto.getRandomValues(octets);
  return Array.from(octets, (o) => o.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** La phrase prévue, suivie de sa référence. */
function avecReference(defaut: string, ref: string): string {
  return `${defaut} ${remplirLeGabarit(dictionnaire()["common.erreur.reference"] ?? "common.erreur.reference", { ref })}`;
}

/** La phrase d'une clé connue du dictionnaire, ou `null`. */
function phraseDeLaCle(message: string): string | null {
  const { cle, valeurs } = lireUnRefus(message);
  const gabarit = dictionnaire()[cle];
  return gabarit === undefined ? null : remplirLeGabarit(gabarit, valeurs);
}

/*
 * Un écran rend `texteDeLErreur(mutation.error, …)` à CHAQUE rendu : sans
 * mémoire, la référence changerait sous les yeux de la personne et le journal
 * recevrait une ligne par rendu. Une erreur garde donc sa référence.
 */
const references = new WeakMap<object, string>();

/**
 * Le texte à afficher, et le journal alimenté au passage.
 *
 * `ou` situe l'erreur — « pièce : lecture », « coffre : suppression ». C'est
 * ce qui permet, en lisant le journal, de savoir quel geste l'a produite.
 */
export function texteDeLErreur(raison: unknown, ou: string, defaut: string): string {
  // Pas de réseau n'est pas une panne : on le dit, sans l'inscrire au journal —
  // le journal ne dirait rien qu'on ne sache déjà.
  if (raison instanceof ErreurReseau)
    return dictionnaire()["common.horsLigne"] ?? "common.horsLigne";
  /*
   * Un refus de notre API (4xx) lève une CLÉ du dictionnaire (« refus.licence.
   * transmission ») : on la dit dans la langue de la personne, avec les
   * valeurs qu'elle cite. Une 5xx est une panne, quel que soit son texte.
   */
  if (raison instanceof ErreurApi && raison.statut < 500) {
    const phrase = phraseDeLaCle(raison.message);
    if (phrase !== null) return phrase;
  }
  if (typeof raison === "object" && raison !== null) {
    const deja = references.get(raison);
    if (deja !== undefined) return avecReference(defaut, deja);
  }
  const ref = nouvelleReference();
  if (typeof raison === "object" && raison !== null) references.set(raison, ref);
  noterAuJournal(ou, raison, ref);
  return avecReference(defaut, ref);
}

/** « [ref 7F3A21C9] … » : la marque que `noterAuJournal` pose en tête d'une ligne. */
const MARQUE_DE_REFERENCE = /^\[ref ([0-9A-F]{8})\] /;

/**
 * Une ligne du journal — une clé et ses valeurs (« refus.moteur.
 * valeur_non_admise?valeur=… »), ou un détail technique —, dite dans la
 * langue de la personne. « Ce qui n'a pas marché » (réglages) relit ainsi le
 * journal : une clé se dit, un détail technique devient la phrase prévue,
 * avec la référence qui le retrouve.
 */
export function direUnRefus(message: string): string {
  const ref = MARQUE_DE_REFERENCE.exec(message)?.[1];
  const reste = ref === undefined ? message : message.slice(ref.length + 7);
  const phrase = phraseDeLaCle(reste);
  if (phrase !== null) return phrase;
  const defaut = dictionnaire()["common.error"] ?? "common.error";
  return ref === undefined ? defaut : avecReference(defaut, ref);
}

/**
 * L'API a répondu que l'objet n'existe pas — ou plus (404). Une pièce
 * effacée par une suppression accordée en est le cas courant : ce n'est pas
 * une panne, et l'écran le dit autrement.
 */
export function estIntrouvable(raison: unknown): boolean {
  return raison instanceof ErreurApi && raison.statut === 404;
}
