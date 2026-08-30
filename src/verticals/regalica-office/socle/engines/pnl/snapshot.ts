import { D, sum, toFixedStr } from "../../domain/decimal";
import type { CurrencyDef, AccountRow } from "../../domain/types";
import type { PnlV1 } from "../../contracts/pnl.v1";

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
}

/** Compte de résultat simplifié : classes 6 (charges) et 7 (produits). */
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
  for (const [code, v] of byAccount) {
    if (!code.startsWith("6") && !code.startsWith("7")) continue;
    const label = input.coa.find((a) => a.account_code === code)?.label ?? code;
    const solde = D(v.debit).minus(v.credit);
    rows.push({
      account_code: code,
      label,
      debit: toFixedStr(D(v.debit), dec),
      credit: toFixedStr(D(v.credit), dec),
      solde: toFixedStr(solde, dec),
    });
    if (code.startsWith("6")) charges = charges.plus(solde);
    if (code.startsWith("7")) produits = produits.plus(solde.negated()); // produits = crédit - débit
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
