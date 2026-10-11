import { D, sum, toFixedStr } from "../../domain/decimal.ts";
import type { CurrencyDef, AccountRow } from "../../domain/types.ts";
import type { AccountClass } from "../../ports/repositories.ts";
import type { PnlV1 } from "../../contracts/pnl.v1.ts";

export interface JournalLineRow {
  account_code: string;
  debit: string;
  credit: string;
}

export interface PnlInput {
  period: string;
  currency: CurrencyDef;
  entries: readonly JournalLineRow[];
  coa: readonly AccountRow[];
  /**
   * Ce qu'est chaque classe du plan, lu au pack. EXIGÉ.
   *
   * Le moteur testait `code.startsWith("6")` : une propriété du plan tunisien
   * écrite dans le code du produit. La première juridiction qui numérote
   * autrement aurait rendu un compte de résultat VIDE — et zéro charge sur un
   * mois qui en porte est un chiffre plausible, donc invisible (R4).
   */
  classes: readonly AccountClass[];
}

/**
 * Compte de résultat simplifié : les comptes dont la classe est une charge ou
 * un produit, le référentiel disant lesquelles.
 */
export function computePnl(input: PnlInput): PnlV1 {
  const dec = input.currency.decimals;
  const byAccount = new Map<string, { debit: string; credit: string }>();
  for (const l of input.entries) {
    const cur = byAccount.get(l.account_code) ?? { debit: "0", credit: "0" };
    cur.debit = D(cur.debit).plus(l.debit).toString();
    cur.credit = D(cur.credit).plus(l.credit).toString();
    byAccount.set(l.account_code, cur);
  }
  const rows: PnlV1["by_account"] = [];
  let charges = D(0);
  let produits = D(0);
  /*
   * La classe se reconnaît au préfixe du code, et le PLUS LONG gagne : un pack
   * qui sortirait un jour les charges financières du résultat le dirait par
   * « 66 », et « 66 » doit l'emporter sur « 6 ».
   */
  const classes = [...input.classes].sort((a, b) => b.prefix.length - a.prefix.length);
  const natureDe = (code: string) => classes.find((c) => code.startsWith(c.prefix))?.nature ?? null;

  for (const [code, v] of byAccount) {
    const nature = natureDe(code);
    /*
     * Ni charge ni produit : hors du compte de résultat, mais PAS hors de
     * l'écran. Un compte d'une classe inconnue — créé par un cabinet, absent
     * du plan livré — figure au détail à zéro d'effet. Un montant qui
     * s'évapore d'un compte de résultat est pire qu'un montant mal rangé : le
     * second se corrige, le premier ne se cherche pas.
     */
    if (nature !== null && nature !== "charge" && nature !== "produit") continue;

    const label = input.coa.find((a) => a.account_code === code)?.label ?? code;
    const solde = D(v.debit).minus(v.credit);
    rows.push({
      account_code: code,
      label,
      debit: toFixedStr(D(v.debit), dec),
      credit: toFixedStr(D(v.credit), dec),
      solde: toFixedStr(solde, dec),
    });
    if (nature === "charge") charges = charges.plus(solde);
    // Un produit est un crédit : son solde débiteur est négatif.
    if (nature === "produit") produits = produits.plus(solde.negated());
  }
  const resultat = produits.minus(charges);
  return {
    contract: "pnl.v1",
    period: input.period,
    currency: input.currency.code,
    produits: toFixedStr(produits, dec),
    charges: toFixedStr(charges, dec),
    resultat: toFixedStr(resultat, dec),
    by_account: rows.sort((a, b) => a.account_code.localeCompare(b.account_code)),
  };
}

// Ré-export pour cohérence
export { sum };
