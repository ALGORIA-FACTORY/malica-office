/**
 * Ce que l'écran des propositions calcule sans rien décider : le lot d'une
 * pièce selon les seuils du cabinet, l'écriture en masse d'un groupe, le
 * compte de charge d'une écriture. Pur, éprouvé, sans React.
 *
 * Rien ici n'est un moteur : les seuils viennent des réglages du cabinet,
 * les montants du Socle ; on classe et l'on additionne, exactement.
 */
import type { Ecriture, EcritureLine } from "@/verticals/regalica-office/ports/repositories";

import { sommeDecimale } from "./somme-decimale";

export type Lot = "haut" | "moyen" | "bas" | "sans";

/** Le lot d'une pièce, d'après les seuils du cabinet. Sans mesure : à part, jamais deviné. */
export function lotDe(confiance: number | null, seuilLot: number, seuilRevue: number): Lot {
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
