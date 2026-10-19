/**
 * Ce que l'écran des propositions calcule sans rien décider : le lot d'une
 * pièce selon les seuils du cabinet, l'écriture en masse d'un groupe, le
 * compte de charge d'une écriture. Pur, éprouvé, sans React.
 *
 * Rien ici n'est un moteur : les seuils viennent des réglages du cabinet,
 * les montants du Socle ; on classe et l'on additionne, exactement.
 */
import type { Ecriture, EcritureLine } from "@malica/socle/ports/repositories";

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

/** Une ligne de l'écriture en masse : un compte, ses pièces, ses totaux. */
export interface LigneDeMasse {
  compte: string;
  libelle: string;
  pieces: number;
  debit: string;
  credit: string;
}

/** L'agrégat exact des écritures retenues, compte par compte, dans l'ordre des comptes. */
export function ecritureEnMasse(ecritures: readonly Ecriture[]): LigneDeMasse[] {
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

/** Le compte de charge d'une écriture : la première ligne de classe 6, sinon le premier débit non nul. */
export function compteDeCharge(e: Ecriture): EcritureLine | null {
  return (
    e.lines.find((l) => l.accountCode.startsWith("6")) ??
    e.lines.find((l) => !/^0(\.0+)?$/.test(l.debit)) ??
    null
  );
}
