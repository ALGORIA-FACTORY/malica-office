/**
 * Le contrat du compte de résultat — la forme des produits, charges et résultat d'un mois.
 *
 * Porte, pour un mois et une devise, les produits, les charges, le résultat et le détail
 * par compte (débit, crédit, solde). Montants en chaînes décimales. Produit par le moteur
 * `engines/pnl`, lu par les écrans de synthèse ; le chiffre vient du moteur, pas de l'IA
 * (R3).
 */
import { z } from "zod";

const CONTRACT_VERSION = "pnl.v1" as const;
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const PnlV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.string().length(3),
  produits: decimalString,
  charges: decimalString,
  resultat: decimalString,
  by_account: z.array(
    z.object({
      account_code: z.string(),
      label: z.string(),
      debit: decimalString,
      credit: decimalString,
      solde: decimalString,
    }),
  ),
});
export type PnlV1 = z.infer<typeof PnlV1>;
