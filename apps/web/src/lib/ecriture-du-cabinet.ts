/**
 * L'écriture que le comptable valide, modifie ou saisit (« Malica sans
 * blocage », maquette « Pièce côté comptabilité », 28 octobre 2026).
 *
 * Une seule table, toujours modifiable : elle part de l'écriture prise en
 * charge, sinon de la proposition du Socle, sinon de rien. Ce qui est
 * validé tel que proposé est « validé » ; ce qui a changé est « forcé ».
 * La décision ne se devine pas à l'écran : elle se lit ici, en décimales
 * exactes, et le serveur la refait (`office.forcer`).
 */
import type { LigneSaisie } from "@malica/socle/ecriture-saisie";
import type { Ecriture, PropositionDePiece } from "@malica/socle/ports/repositories";
import { enUnitesExactes } from "@malica/socle/somme-decimale";

import { saisieDecimale } from "@malica/socle/saisie-decimale";

/** D'où part la table : l'écriture prise en charge, la proposition, ou rien. */
export type Depart = "inscrite" | "proposee" | "rien";

export interface EcritureEnSaisie {
  journal: string;
  date: string;
  libelle: string;
  lignes: LigneSaisie[];
}

/** L'écriture de départ, et d'où elle vient. */
export function ecritureDeDepart(
  vivante: Ecriture | null,
  proposition: PropositionDePiece | undefined,
): EcritureEnSaisie & { depart: Depart } {
  if (vivante) {
    return {
      depart: "inscrite",
      journal: vivante.journal,
      date: vivante.dateEcriture,
      libelle: vivante.libelle,
      lignes: vivante.lines.map((l) => ({
        account_code: l.accountCode,
        libelle: l.libelle,
        debit: l.debit,
        credit: l.credit,
        tax_code: l.taxCode,
      })),
    };
  }
  if (proposition?.ok) {
    const p = proposition.proposition;
    return {
      depart: "proposee",
      journal: p.journal,
      date: p.pivot.entry_date,
      libelle: p.libelle,
      lignes: p.lignes.map((l) => ({ ...l })),
    };
  }
  return { depart: "rien", journal: "", date: "", libelle: "", lignes: [] };
}

/**
 * Les montants tapés, relus comme le Socle les recevra : « 1 234,500 »
 * devient « 1234.500 ». Ce qui ne se relit pas reste tel quel — le contrôle
 * de la saisie le dira illisible, au lieu de le taire.
 */
export function relue(l: LigneSaisie): LigneSaisie {
  const montant = (v: string) => (v.trim() === "" ? "" : (saisieDecimale(v) ?? v));
  return { ...l, debit: montant(l.debit), credit: montant(l.credit) };
}

/** Deux montants égaux à l'unité de la devise près ; un illisible n'égale rien. */
function memeMontant(a: string, b: string, decimales: number): boolean {
  try {
    const lu = (v: string) => enUnitesExactes(v.trim() === "" ? "0" : v, decimales);
    return lu(a) === lu(b);
  } catch {
    return false;
  }
}

/**
 * La saisie dit-elle exactement l'écriture de départ ? Même journal, même
 * date, même libellé, et les mêmes lignes dans le même ordre — comptes,
 * libellés, codes de taxe et montants exacts. Sinon, elle sera « forcée ».
 */
export function inchangee(
  saisie: EcritureEnSaisie,
  depart: EcritureEnSaisie,
  decimales: number,
): boolean {
  return (
    saisie.journal === depart.journal &&
    saisie.date === depart.date &&
    saisie.libelle.trim() === depart.libelle.trim() &&
    saisie.lignes.length === depart.lignes.length &&
    saisie.lignes.every((l, i) => {
      const d = depart.lignes[i]!;
      return (
        l.account_code.trim() === d.account_code.trim() &&
        l.libelle.trim() === d.libelle.trim() &&
        (l.tax_code ?? null) === (d.tax_code ?? null) &&
        memeMontant(l.debit, d.debit, decimales) &&
        memeMontant(l.credit, d.credit, decimales)
      );
    })
  );
}

/** Une ligne vide, à remplir. */
export const LIGNE_VIDE: LigneSaisie = {
  account_code: "",
  libelle: "",
  debit: "",
  credit: "",
  tax_code: null,
};
