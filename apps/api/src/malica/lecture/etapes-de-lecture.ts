/**
 * Les étapes de la lecture d'une pièce, au journal d'observabilité.
 *
 * ================================================================= POURQUOI
 *
 * La facture MyTek (novembre 2026) : 510,000 imprimé, 810,000 à l'écran, et
 * aucun moyen de dire OÙ la valeur avait changé. Chaque étape de la chaîne
 * dit désormais ce qu'elle a vu ou décidé, sous la trace de l'opération :
 *
 *   ocr          le lecteur, son modèle, sa durée, son issue ;
 *   extraction   les montants que la lecture PROPOSE, relus dans le plan ;
 *   sudoku       son verdict, la règle qui tranche, l'écart avec la lecture ;
 *   rattrapage   déclenché ou non, et la raison NOMMÉE ;
 *   persistance  les montants effectivement enregistrés, et la ligne ;
 *   jugement     le verdict du Socle (`scan/analyse.ts`).
 *
 * Ce qui n'y entre jamais : la photo, le texte OCR, un jeton. Ce qui est déjà
 * stocké (`capture.extractions`, `capture.analyses`) est référencé par son
 * identifiant, pas recopié. Les clés permises sont en base
 * (`observabilite.etapes`, migration 20261118140000) : une clé qui n'y est pas
 * est écartée par la porte.
 *
 * ================================================================= LA CLÉ
 *
 * (pièce, passe) : la même passe rejouée sous la même trace — un renvoi, un
 * rejeu du fichier d'attente — compte une répétition, jamais une ligne.
 */
import { D, toFixedStr } from "@malica/socle/domain/decimal";
import { sommeDecimale } from "@malica/socle/somme-decimale";

import { codeDuRefus, consigner, issueDeLErreur } from "../../observabilite/journal.ts";

import type { BuiltRead } from "./read-piece.ts";
import type { VisionRead } from "./vision.ts";

/** La passe d'une lecture : la première, le rattrapage synchrone, la relecture de nuit. */
export type Passe = "premiere" | "rattrapage" | "relecture";

const cle = (pieceId: string, passe: Passe | string) => `${pieceId}:${passe}`;

/** Le nom d'une erreur, jamais son message : un message peut citer ce que la pièce porte. */
function nomDeLErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.name : typeof erreur;
}

/** L'appel au lecteur (relevé et désignation) : son issue, son lecteur, sa durée. */
export async function tracerLOcr(
  pieceId: string,
  passe: Passe,
  lire: () => Promise<VisionRead>,
): Promise<VisionRead> {
  const debut = new Date();
  try {
    const lu = await lire();
    consigner("ocr", "ok", {
      cle: cle(pieceId, passe),
      piece: pieceId,
      debut,
      dureeMs: Date.now() - debut.getTime(),
      detail: {
        passe,
        lecteur: lu.lecteur,
        modele: lu.readModel,
        modele_designation: lu.selectModel,
        jetons: lu.tokens.length,
        latence_ms: lu.latencyMs,
        paddle_tente: lu.paddleTente,
      },
    });
    return lu;
  } catch (erreur) {
    consigner("ocr", issueDeLErreur(erreur), {
      cle: cle(pieceId, passe),
      piece: pieceId,
      debut,
      dureeMs: Date.now() - debut.getTime(),
      detail: { passe, erreur: nomDeLErreur(erreur) },
    });
    throw erreur;
  }
}

/** Les montants d'un extrait, tels que le contrat les porte (chaînes décimales). */
function montantsDe(extract: Record<string, unknown>, decimales: number) {
  const totaux = (extract["totals"] ?? {}) as Record<string, string | null | undefined>;
  const droits = ((extract["other_charges"] ?? []) as Array<{ code: string; amount: string }>)
    .map((c) => ({ code: c.code, montant: c.amount }))
    .filter((c) => typeof c.montant === "string");
  return {
    devise: typeof extract["currency"] === "string" ? extract["currency"] : null,
    base_ht: totaux["base_ht"] ?? null,
    tva: totaux["vat"] ?? null,
    ttc: totaux["ttc"] ?? null,
    droits:
      droits.length > 0
        ? sommeDecimale(
            droits.map((d) => d.montant),
            decimales,
          )
        : null,
    codes_droits: droits.length > 0 ? droits.map((d) => d.code).join(",") : null,
  };
}

/**
 * Ce que la lecture PROPOSE : la désignation du lecteur relue dans le plan,
 * avant que le sudoku n'en remplace les montants.
 */
export function tracerLExtraction(
  pieceId: string,
  passe: Passe,
  lu: BuiltRead,
  qualite: number,
  decimales: number,
): void {
  const incoherences = lu.flags.filter((f) => f.code === "ARITHMETIQUE_INCOHERENTE");
  consigner("extraction", "ok", {
    cle: cle(pieceId, passe),
    piece: pieceId,
    detail: {
      passe,
      contrat: lu.contract,
      qualite,
      ...montantsDe(lu.extract, decimales),
      // Le TTC recomposé par le Socle depuis le montant écrit en lettres (`read-piece.ts`).
      ttc_par_lettres: lu.flags.some(
        (f) => f.field === "totals.ttc" && f.code === "DERIVED_BY_SOCLE",
      ),
      citations: lu.citations.length,
      drapeaux: lu.flags.length,
      incoherences: incoherences.length,
      incoherence: incoherences[0]?.detail ?? null,
    },
  });
}

/** Ce que le sudoku a rendu d'une lecture (`Sudoku.verdict`). */
export interface VerdictDuSudoku {
  readonly mode: string | null;
  readonly issue: string;
  /** La pièce est-elle désignée par la preuve (mode `designe`, pièce prouvée) ? */
  readonly designee: boolean;
  /** Ce qui tranche : le champ pris dans les lettres, sinon la variante qui ferme. */
  readonly regle: string | null;
  readonly raison: string | null;
  readonly solutions: number | null;
  readonly baseHt: string | null;
  readonly tva: string | null;
  readonly ttc: string | null;
  readonly droits: string | null;
  /** Le montant lu en lettres dans le plan, s'il y en a un. */
  readonly lettres: string | null;
  /** Le statut de la preuve des lettres (`verifiee`, `contredite`…), s'il y en a une. */
  readonly preuveLettres: string | null;
  /** Le sudoku n'a pas pu juger : son erreur, nommée. */
  readonly erreur: string | null;
}

/**
 * Le verdict du sudoku, et son écart avec la lecture : TTC proposé − TTC
 * prouvé, quand les deux sont connus.
 */
export function tracerLeSudoku(
  pieceId: string,
  passe: Passe,
  verdict: VerdictDuSudoku | null,
  proposee: BuiltRead,
  decimales: number,
): void {
  if (!verdict) return;
  const ttcPropose = montantsDe(proposee.extract, decimales).ttc;
  const ecart =
    ttcPropose !== null && verdict.ttc !== null
      ? toFixedStr(D(ttcPropose).minus(D(verdict.ttc)), decimales)
      : null;
  consigner("sudoku", verdict.erreur ? "erreur" : "ok", {
    cle: cle(pieceId, passe),
    piece: pieceId,
    detail: {
      passe,
      mode: verdict.mode,
      issue: verdict.issue,
      designee: verdict.designee,
      regle: verdict.regle,
      raison: verdict.raison,
      solutions: verdict.solutions,
      base_ht: verdict.baseHt,
      tva: verdict.tva,
      ttc: verdict.ttc,
      droits: verdict.droits,
      lettres: verdict.lettres,
      preuve_lettres: verdict.preuveLettres,
      ecart_ttc: ecart,
      erreur: verdict.erreur,
    },
  });
}

/** Pourquoi le rattrapage part, ou ne part pas : une raison nommée, jamais un silence. */
export type RaisonDuRattrapage =
  | "lecture_parfaite"
  | "piece_prouvee"
  | "sans_autre_lecteur"
  | "contrat_partiel"
  | "montants_incoherents"
  | "contrat_partiel_et_montants_incoherents"
  // La relecture de nuit qui s'abstient : le motif de la base (`fabrique.relecture_a_faire`).
  | `abstention_${string}`;

export function raisonDuRattrapage(
  lu: { readonly contract: string; readonly flags: ReadonlyArray<{ readonly code: string }> },
  parfaite: boolean,
  autreLecteur: boolean,
  prouvee: boolean,
): RaisonDuRattrapage {
  if (parfaite) return "lecture_parfaite";
  if (prouvee) return "piece_prouvee";
  if (!autreLecteur) return "sans_autre_lecteur";
  const partiel = lu.contract !== "extract.v1";
  const incoherent = lu.flags.some((f) => f.code === "ARITHMETIQUE_INCOHERENTE");
  if (partiel && incoherent) return "contrat_partiel_et_montants_incoherents";
  return partiel ? "contrat_partiel" : "montants_incoherents";
}

export function tracerLeRattrapage(
  pieceId: string,
  passe: Passe,
  issue: { declenche: boolean; raison: RaisonDuRattrapage; differe: boolean; qualiteAvant: number },
  suite: { qualiteApres?: number; retenue?: boolean; lecteur?: string; erreur?: unknown } = {},
): void {
  consigner("rattrapage", suite.erreur === undefined ? "ok" : "erreur", {
    cle: cle(pieceId, passe),
    piece: pieceId,
    detail: {
      declenche: issue.declenche,
      raison: issue.raison,
      differe: issue.differe,
      qualite_avant: issue.qualiteAvant,
      qualite_apres: suite.qualiteApres ?? null,
      retenue: suite.retenue ?? null,
      lecteur: suite.lecteur ?? null,
      erreur: suite.erreur === undefined ? null : nomDeLErreur(suite.erreur),
    },
  });
}

/** La persistance : la ligne inscrite et ses montants, ou le refus de la base. */
export async function tracerLaPersistance(
  pieceId: string,
  passe: Passe,
  lu: BuiltRead,
  decimales: number,
  persister: () => Promise<{ extractionId: string | null }>,
): Promise<{ extractionId: string | null }> {
  const debut = new Date();
  const montants = montantsDe(lu.extract, decimales);
  try {
    const inscrite = await persister();
    consigner("persistance", "ok", {
      cle: cle(pieceId, passe),
      piece: pieceId,
      debut,
      dureeMs: Date.now() - debut.getTime(),
      detail: {
        passe,
        extraction_id: inscrite.extractionId,
        contrat: lu.contract,
        devise: montants.devise,
        base_ht: montants.base_ht,
        tva: montants.tva,
        ttc: montants.ttc,
        droits: montants.droits,
      },
    });
    return inscrite;
  } catch (erreur) {
    consigner("persistance", issueDeLErreur(erreur), {
      cle: cle(pieceId, passe),
      piece: pieceId,
      debut,
      dureeMs: Date.now() - debut.getTime(),
      detail: {
        passe,
        contrat: lu.contract,
        erreur: nomDeLErreur(erreur),
        code_refus: erreur instanceof Error ? codeDuRefus(erreur.message) : null,
      },
    });
    throw erreur;
  }
}
