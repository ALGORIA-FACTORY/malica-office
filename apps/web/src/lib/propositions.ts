/**
 * Ce que l'écran des propositions calcule sans rien décider : le lot d'une
 * pièce selon les seuils du cabinet, l'écriture en masse d'un groupe, le
 * compte de charge d'une écriture. Pur, éprouvé, sans React.
 *
 * Rien ici n'est un moteur : les seuils viennent des réglages du cabinet,
 * les montants du Socle ; on classe et l'on additionne, exactement.
 */
import type { EcritureLine } from "@malica/socle/ports/repositories";

import { sommeDecimale } from "@malica/socle/somme-decimale";

export type Lot = "recette" | "haut" | "moyen" | "bas" | "sans";

/**
 * Le lot d'une pièce, d'après les seuils du cabinet.
 *
 * ================================= UNE LECTURE PAR RECETTE PASSE AVANT TOUT
 *
 * Elle est testée la PREMIÈRE, et avant toute comparaison de seuil, parce que
 * la pièce qu'une recette a lue porte `overall_confidence = 1` : une recette
 * ne produit aucun score, et le neutre du minimum — « la désignation n'abaisse
 * rien » — est passé explicitement au point d'appel. Comparé à un seuil, ce
 * neutre franchit tout : la pièce s'affichait « 100 % » sous « Confiance
 * min. » et tombait dans les validables d'un geste. Un expert validait en
 * masse des pièces présentées comme certaines à cent pour cent, alors que le
 * chiffre ne signifiait rien — c'était une absence de score, pas une
 * certitude.
 *
 * Son lot n'est donc pas un lot de confiance basse : c'est un lot d'une autre
 * nature, et il ne se valide pas d'un geste au titre d'une confiance qui
 * n'existe pas. Ce qu'on en sait est plus fort qu'un score — chaque champ
 * désigné est relu dans le plan de jetons —, mais ce n'est pas une
 * probabilité, et rien à l'écran ne doit le laisser croire.
 *
 * Sans mesure : à part aussi, et pour une autre raison — jamais deviné.
 */
export function lotDe(
  confiance: number | null,
  seuilLot: number,
  seuilRevue: number,
  lueParRecette = false,
): Lot {
  if (lueParRecette) return "recette";
  if (confiance === null) return "sans";
  if (confiance >= seuilLot) return "haut";
  if (confiance >= seuilRevue) return "moyen";
  return "bas";
}

/**
 * Ce que « Valider » d'un client valide d'un geste.
 *
 * Staging, 5 novembre 2026 : le bouton validait TOUTES les pièces du client —
 * 62, dont 20 sous le seuil de revue une à une, à 20 % de confiance —, alors
 * que le cabinet a réglé « Validation en lot au-dessus de 90 % ». Sans
 * sélection, il ne valide donc que le lot « haut », au sens de `lotDe`. Une
 * sélection faite par l'expert, pièce par pièce ou « tout le lot », est son
 * choix explicite : elle part telle quelle. Seuils inconnus : rien.
 */
export function aValiderDUnGeste<T extends { pieceId: string; confiance: number | null }>(
  pieces: readonly T[],
  retenues: readonly T[],
  seuilLot: number | null,
  seuilRevue: number | null,
  lueParRecette: (pieceId: string) => boolean,
): T[] {
  if (retenues.length > 0) return [...retenues];
  if (seuilLot === null || seuilRevue === null) return [];
  return pieces.filter(
    (p) => lotDe(p.confiance, seuilLot, seuilRevue, lueParRecette(p.pieceId)) === "haut",
  );
}

/** Une ligne de l'écriture en masse : un compte, ses pièces, ses totaux. */
export interface LigneDeMasse {
  compte: string;
  libelle: string;
  pieces: number;
  debit: string;
  credit: string;
}

/**
 * Une écriture vue par l'écran des propositions : celle qui est inscrite, ou
 * celle que le Socle propose — identifiée par sa pièce ou par elle-même.
 */
export interface EcritureDuLot {
  id: string;
  lines: readonly EcritureLine[];
}

/** L'agrégat exact des écritures retenues, compte par compte, dans l'ordre des comptes. */
export function ecritureEnMasse(ecritures: readonly EcritureDuLot[]): LigneDeMasse[] {
  const parCompte = new Map<
    string,
    { libelle: string; pieces: Set<string>; debits: string[]; credits: string[] }
  >();
  for (const e of ecritures) {
    for (const l of e.lines) {
      const c = parCompte.get(l.accountCode) ?? {
        libelle: l.libelle,
        pieces: new Set<string>(),
        debits: [],
        credits: [],
      };
      c.pieces.add(e.id);
      c.debits.push(l.debit);
      c.credits.push(l.credit);
      parCompte.set(l.accountCode, c);
    }
  }
  return [...parCompte.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([compte, c]) => ({
      compte,
      libelle: c.libelle,
      pieces: c.pieces.size,
      debit: sommeDecimale(c.debits),
      credit: sommeDecimale(c.credits),
    }));
}

/**
 * Une ligne de charge (classe 6) ou de produit (classe 7) : celle que l'on
 * réimpute. Une vente se corrige comme un achat (ANO-CAB-005) ; tiers, TVA
 * et trésorerie ne bougent pas.
 */
export function estChargeOuProduit(compte: string): boolean {
  return compte.startsWith("6") || compte.startsWith("7");
}

/** Le compte de charge ou de produit d'une écriture, sinon le premier débit non nul. */
export function compteDeCharge(e: EcritureDuLot): EcritureLine | null {
  return (
    e.lines.find((l) => estChargeOuProduit(l.accountCode)) ??
    e.lines.find((l) => !/^0(\.0+)?$/.test(l.debit)) ??
    null
  );
}

/** Ce qu'un lot a donné : combien de pièces sont passées, combien ont échoué, et pourquoi. */
export interface BilanDuLot {
  passees: number;
  echecs: number;
  /** La raison du premier échec, lisible ; `null` quand tout est passé. */
  raison: string | null;
}

/**
 * Un lot passe pièce par pièce, chacune dans sa transaction : une pièce qui
 * échoue n'arrête pas les autres, et l'écran dit combien sont passées et
 * combien ont échoué — au lieu de s'arrêter à la première sans rien dire des
 * suivantes.
 */
export async function parPiece<T>(
  elements: readonly T[],
  raisonDe: (erreur: unknown) => string,
  geste: (element: T) => Promise<unknown>,
): Promise<BilanDuLot> {
  const bilan: BilanDuLot = { passees: 0, echecs: 0, raison: null };
  for (const e of elements) {
    try {
      await geste(e);
      bilan.passees += 1;
    } catch (x) {
      bilan.echecs += 1;
      bilan.raison ??= raisonDe(x);
    }
  }
  return bilan;
}
