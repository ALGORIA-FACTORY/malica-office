/**
 * L'écriture que le comptable saisit ou modifie — « forcée » (spec §4).
 *
 * Le Socle ne propose rien quand les montants lus ne se recoupent pas : le
 * comptable saisit alors l'écriture lui-même. Ce contrôle est le même pour
 * l'écran, qui dit « Équilibrée » ou ce qui manque, et pour l'API, qui refuse
 * avant d'écrire : deux contrôles finiraient par se contredire.
 *
 * Les montants sont des décimales EXACTES, lues en unités de la devise (le
 * nombre de décimales vient du pack, jamais d'ici — R4). Un flottant ne sait
 * pas que 0,1 + 0,2 = 0,3 ; la base, si, et elle refuserait une écriture que
 * l'écran aurait dite équilibrée.
 */
import { enUnitesExactes, sommeDecimale } from "./somme-decimale.ts";

/** Une ligne telle qu'elle part au Socle (`socle_ecriture_propose`). */
export interface LigneSaisie {
  account_code: string;
  libelle: string;
  debit: string;
  credit: string;
  tax_code: string | null;
}

/**
 * Ce qui empêche d'inscrire, dans l'ordre où on le dit : une écriture a au
 * moins deux lignes ; chaque ligne a un compte, un montant lisible dans la
 * devise, et un seul sens ; débit = crédit.
 */
export type DefautDeSaisie = "lignes" | "compte" | "montant" | "sens" | "desequilibre";

export interface ControleDeSaisie {
  totalDebit: string;
  totalCredit: string;
  defaut: DefautDeSaisie | null;
}

/** Un champ vide vaut zéro ; une virgule décimale vaut un point. */
const montantSaisi = (v: string) => (v.trim() === "" ? "0" : v.trim().replace(",", "."));

function unites(v: string, decimales: number): bigint | null {
  try {
    const u = enUnitesExactes(montantSaisi(v), decimales);
    return u < 0n ? null : u;
  } catch {
    return null;
  }
}

export function controlerLaSaisie(
  lignes: readonly LigneSaisie[],
  decimales: number,
): ControleDeSaisie {
  const lus = lignes.map((l) => ({
    compte: l.account_code.trim(),
    debit: unites(l.debit, decimales),
    credit: unites(l.credit, decimales),
  }));
  const lisibles = lus.every((l) => l.debit !== null && l.credit !== null);
  const totaux = (cote: "debit" | "credit") =>
    lisibles
      ? sommeDecimale(
          lignes.map((l) => montantSaisi(l[cote])),
          decimales,
        )
      : "";
  const totalDebit = totaux("debit");
  const totalCredit = totaux("credit");
  const defaut: DefautDeSaisie | null =
    lignes.length < 2
      ? "lignes"
      : lus.some((l) => l.compte === "")
        ? "compte"
        : !lisibles
          ? "montant"
          : lus.some((l) => (l.debit! > 0n) === (l.credit! > 0n))
            ? "sens"
            : totalDebit !== totalCredit
              ? "desequilibre"
              : null;
  return { totalDebit, totalCredit, defaut };
}

/** La ligne prête à partir : montants normalisés, compte sans espaces. */
export function ligneNormalisee(l: LigneSaisie): LigneSaisie {
  return {
    account_code: l.account_code.trim(),
    libelle: l.libelle.trim(),
    debit: montantSaisi(l.debit),
    credit: montantSaisi(l.credit),
    tax_code: l.tax_code,
  };
}
