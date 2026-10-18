/**
 * Chercher et classer les recettes applicables à un document — module pur.
 *
 * ================================================================= POURQUOI
 *
 * Avant d'interpréter, il faut savoir QUELLE recette interpréter. Le danger
 * n'est pas de ne pas reconnaître — on rend alors la main au modèle, et il
 * ne se passe rien de grave. Le danger est de reconnaître À TORT : une
 * recette juste appliquée au mauvais format rend un résultat plausible et
 * faux, et c'est la pire forme d'erreur que ce dépôt nomme.
 *
 * Ce module ne réécrit RIEN de la signature : il appelle `signerLePlan`,
 * `ossatureCommune` et `classerLesCandidats`, et il ajoute la seule chose
 * qu'ils ne font pas — refuser de travailler sur une ossature qu'on ne peut
 * pas avoir.
 *
 * ================================= LA RECONNAISSANCE EST EN DEUX TEMPS ====
 *
 * C'est la limite que le spécialiste de la signature a nommée et éprouvée :
 * RIEN, DANS UNE PAGE, NE DISTINGUE LE NOM DE L'ÉMETTEUR — qui est de la
 * structure — DU NOM DU CLIENT, qui est une valeur. Les deux sont
 * alphabétiques, les deux sont posés à côté d'un libellé. Un vocabulaire les
 * séparerait ; R4 l'interdit.
 *
 * Seule `ossatureCommune`, sur PLUSIEURS signatures, fait tomber ce qui
 * varie. Une recette tirée d'un seul exemple apprendrait donc le nom du
 * client comme s'il était la forme du papier, et ne reconnaîtrait plus jamais
 * qu'une facture : la sienne.
 *
 * ========================================= CE QUI A ÉTÉ TRANCHÉ, ET POURQUOI
 *
 * Un format dont on n'a qu'UN exemple n'est PAS un candidat. Il est écarté,
 * nommément, et la raison remonte à l'appelant ; il n'est pas « comparé avec
 * prudence », il ne concourt pas.
 *
 * Ce minimum n'est pas un seuil, et c'est pour cela qu'il n'est pas dans le
 * référentiel : à un exemple, l'ossature n'est pas plus permissive, elle
 * N'EXISTE PAS — `ossatureCommune([s])` rend exactement les ancres de `s`,
 * valeurs comprises. Un réglage qui l'autoriserait ne réglerait rien : il
 * ferait seulement taire le seul garde-fou du premier temps. Les trois jeux
 * de paramètres qui, eux, sont des seuils viennent bien du référentiel
 * (`interprete-reglages.ts`).
 *
 * ========================================================= CE QU'IL NE FAIT PAS
 *
 * Il ne décide pas qu'on s'abstient : il rend un verdict. L'abstention, et
 * le retour à la désignation par le modèle, appartiennent au branchement.
 */
import type { PageToken } from "@malica/socle/ports/malica";

import {
  classerLesCandidats,
  ossatureCommune,
  type CandidatDeFormat,
  type Classement,
  type ParametresDeClassement,
  type ParametresDeDistance,
} from "./signature-distance.ts";
import { signerLePlan, type ParametresDeSignature, type SignatureDeDocument } from "./signature.ts";

/**
 * Combien d'exemples il faut pour qu'une ossature soit une ossature.
 *
 * Deux. Voir l'en-tête : à un, `ossatureCommune` rend les ancres de l'unique
 * exemple — le nom de son client compris —, et la comparaison se cale sur une
 * valeur en croyant se caler sur une forme.
 */
export const EXEMPLES_MINIMUM_POUR_UNE_OSSATURE = 2;

/** Un format connu : sa recette, et les exemples qui l'ont nourrie. */
export interface FormatConnu {
  /** Ce que l'appelant veut retrouver — en base, un `recette_version_id`. */
  readonly id: string;
  /** Les signatures des exemples d'APPRENTISSAGE de cette version. */
  readonly exemples: readonly SignatureDeDocument[];
}

/** Pourquoi un format n'a pas concouru. */
interface FormatEcarte {
  readonly id: string;
  readonly motif: "ossature_insuffisante";
  readonly detail: string;
}

export interface Reconnaissance {
  /** La signature du document soumis — l'appelant la stocke, elle a un coût. */
  readonly signature: SignatureDeDocument;
  readonly classement: Classement;
  readonly ecartes: readonly FormatEcarte[];
  /**
   * L'ossature du format retenu, quand il y en a un : c'est elle qui a servi
   * à comparer, et l'appelant doit pouvoir dire sur quoi il a reconnu.
   */
  readonly ossature: readonly string[] | null;
}

/**
 * Le candidat d'un format : sa signature de référence et son ossature.
 *
 * La signature de référence est celle du PREMIER exemple ; l'ossature, celle
 * de tous. La distance est donc calculée sur les seules ancres que tous les
 * exemplaires partagent, et devient aveugle à ce qui varie de l'un à l'autre
 * — c'est exactement ce que `distanceEntreSignatures` fait de son argument
 * `ossature`.
 */
function candidatDuFormat(format: FormatConnu): CandidatDeFormat | FormatEcarte {
  if (format.exemples.length < EXEMPLES_MINIMUM_POUR_UNE_OSSATURE) {
    return {
      id: format.id,
      motif: "ossature_insuffisante",
      detail:
        `${String(format.exemples.length)} exemple(s) : il en faut ` +
        `${String(EXEMPLES_MINIMUM_POUR_UNE_OSSATURE)} pour qu'une ancre variable tombe`,
    };
  }
  const ossature = ossatureCommune(format.exemples);
  if (ossature.length === 0) {
    return {
      id: format.id,
      motif: "ossature_insuffisante",
      detail: "les exemples ne partagent aucune ancre : il n'y a pas de forme commune",
    };
  }
  return { id: format.id, signature: format.exemples[0]!, ossature };
}

/**
 * Reconnaît le format d'un plan de jetons parmi des formats connus.
 *
 * Trois sorties, et la troisième est la raison d'être de la mesure :
 * `aucun`, `un`, et `ambigu` — « rien ne départage ces candidats ». Jamais
 * « le premier ».
 */
export function reconnaitre(
  plan: readonly PageToken[],
  formats: readonly FormatConnu[],
  parametres: ParametresDeSignature,
  distance: ParametresDeDistance,
  classement: ParametresDeClassement,
): Reconnaissance {
  const signature = signerLePlan(plan, parametres);

  const candidats: CandidatDeFormat[] = [];
  const ecartes: FormatEcarte[] = [];
  for (const format of formats) {
    const juge = candidatDuFormat(format);
    if ("motif" in juge) ecartes.push(juge);
    else candidats.push(juge);
  }

  const classe = classerLesCandidats(signature, candidats, distance, classement);
  const verdict = classe.verdict;
  const retenu =
    verdict.sorte === "un" ? (candidats.find((c) => c.id === verdict.id)?.ossature ?? null) : null;

  return { signature, classement: classe, ecartes, ossature: retenu };
}
