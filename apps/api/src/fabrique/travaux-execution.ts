/**
 * Exécuter un travail de la file — et ne pas confondre trois échecs.
 *
 * ================================================ LES TROIS, ET POURQUOI
 *
 * Le dépôt les confond aujourd'hui sous un `catch` unique dans
 * `malica.ts` : « lecture d'arrière-plan échouée », une ligne de journal, et
 * la même suite pour tous. Ce sont pourtant trois choses qui ne se traitent
 * pas pareil :
 *
 *   refus_metier       le plafond est atteint, la pièce est personnelle, la
 *                      licence est suspendue. CE N'EST PAS UNE PANNE. Le
 *                      rejouer retesterait le même plafond sans fin, et la
 *                      personne attendrait une réponse qui ne viendra pas.
 *                      Le travail se ferme, avec le motif de la base.
 *
 *   panne_fournisseur  le modèle n'a pas répondu. À réessayer, après le
 *                      délai de repli, dans la limite des tentatives — les
 *                      trois viennent du référentiel.
 *
 *   erreur_technique   un défaut de NOTRE code. À ne surtout pas réessayer
 *                      en boucle : la boucle brûlerait des appels payants
 *                      sur un bogue que seul un correctif résout.
 *
 * ================================= POURQUOI « TECHNIQUE » EST LE DÉFAUT
 *
 * Une erreur qu'on ne sait pas nommer n'est PAS rejouée. Rejouer par
 * optimisme est la faute coûteuse : c'est elle qui transforme un bogue en
 * facture. Un organe qui sait qu'il est tombé pour une cause passagère le
 * DIT, en levant `PanneFournisseur` ; tant qu'il ne le dit pas, on ne le
 * suppose pas à sa place.
 */

import type { Requete } from "../db.ts";

import {
  inscrireIssue,
  prendreUnTravail,
  type IssueDeTentative,
  type NatureDeTravail,
  type TravailPris,
} from "./travaux.ts";

/** La nature d'un échec, telle que la base la nomme. */
export type NatureDEchec = Extract<
  IssueDeTentative,
  "refus_metier" | "panne_fournisseur" | "erreur_technique"
>;

/** Une erreur qui porte sa propre nature — les trois classes ci-dessous. */
interface Qualifiee {
  natureEchec: NatureDEchec;
}

/**
 * La base a dit non, et elle a eu raison : plafond, pièce personnelle,
 * licence suspendue. Le motif est celui de `lecture_autorisee`, tel quel ;
 * ses libellés vivent au référentiel (R4), jamais ici.
 */
export class RefusMetier extends Error implements Qualifiee {
  readonly natureEchec = "refus_metier" as const;
  constructor(motif: string) {
    super(motif);
    this.name = "RefusMetier";
  }
}

/** Le fournisseur n'a pas répondu. C'est la SEULE qu'on rejoue. */
export class PanneFournisseur extends Error implements Qualifiee {
  readonly natureEchec = "panne_fournisseur" as const;
  constructor(motif: string) {
    super(motif);
    this.name = "PanneFournisseur";
  }
}

/**
 * Qualifie un échec.
 *
 * `LectureRefusee` est reconnue à SON NOM et non par un import : importer la
 * classe tirerait toute la chaîne de lecture — donc les deux organes
 * payants — dans la file, pour un `instanceof`. Le nom est posé par le
 * constructeur de `malica/lecture/read-flow.ts` et ne bouge pas.
 */
export function qualifierEchec(erreur: unknown): NatureDEchec {
  const e = erreur as Partial<Qualifiee> & { name?: string };
  if (
    e?.natureEchec === "refus_metier" ||
    e?.natureEchec === "panne_fournisseur" ||
    e?.natureEchec === "erreur_technique"
  ) {
    return e.natureEchec;
  }
  if (e?.name === "LectureRefusee") return "refus_metier";
  return "erreur_technique";
}

/** Ce qu'une exécution a donné, pour celui qui fait tourner la file. */
export interface ResultatDExecution {
  travailId: string;
  pieceId: string;
  tentative: number;
  issue: IssueDeTentative;
  motif: string | null;
}

/** Ouvre une transaction courte sous l'identité — `sousIdentite` en service. */
export type AvecBase = <T>(travail: (db: Requete) => Promise<T>) => Promise<T>;

/**
 * Prend un travail, l'exécute, inscrit son issue. Rend `null` s'il n'y avait
 * rien à prendre.
 *
 * `natures` est la liste de ce que cet appelant SAIT exécuter, et elle n'est
 * pas facultative : la file porte deux natures depuis le 20 octobre, et un
 * exécuteur qui ne le dit pas prendrait une génération pour la faire lire.
 *
 * TROIS TRANSACTIONS, ET C'EST LE POINT. La prise est COMMISE avant que
 * l'exécution commence : une lecture dure de dix secondes à quelques minutes,
 * et la base coupe une transaction inactive après dix. Tenir la transaction
 * ouverte pendant l'appel au modèle — le réflexe du `select … for update` —
 * ne marcherait pas ici, et c'est tant mieux : c'est justement parce que la
 * prise est déjà en base que la mort du processus devient réparable. Le
 * travail reste « en cours » jusqu'à l'âge d'abandon, puis redevient
 * prenable, tout seul.
 */
export async function executerUnTravail(
  avecBase: AvecBase,
  tenantId: string,
  natures: readonly NatureDeTravail[],
  executer: (travail: TravailPris) => Promise<void>,
): Promise<ResultatDExecution | null> {
  const pris = await avecBase(async (db) => prendreUnTravail(db, tenantId, natures));
  if (!pris) return null;

  let issue: IssueDeTentative = "termine";
  let motif: string | null = null;
  try {
    await executer(pris);
  } catch (erreur) {
    issue = qualifierEchec(erreur);
    motif = erreur instanceof Error ? erreur.message.slice(0, 500) : String(erreur);
  }

  await avecBase(async (db) =>
    inscrireIssue(db, {
      tenantId,
      travailId: pris.travailId,
      tentative: pris.tentative,
      nature: issue,
      ...(motif === null ? {} : { motif }),
    }),
  );

  return {
    travailId: pris.travailId,
    pieceId: pris.pieceId,
    tentative: pris.tentative,
    issue,
    motif,
  };
}
