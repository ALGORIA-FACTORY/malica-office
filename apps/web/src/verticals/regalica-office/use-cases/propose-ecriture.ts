/**
 * Cas d'usage : proposer l'écriture d'une pièce lue.
 * Le calcul est intégralement délégué au Socle ; ce module n'assemble que les
 * données du référentiel (taux, imputations) et traduit la sortie du moteur
 * en lignes persistables. Aucune valeur monétaire n'est produite ici.
 */

import { computePivot } from "../socle";
import { composerLibelle } from "../socle/engines/libelle";
import { faitsDuLibelle } from "./libelle-de-piece";
import type { ExtractV1 as ExtractV1Type } from "../socle/contracts/extract.v1";
import { ExtractV1 } from "../socle/contracts/extract.v1";
import type { PivotV1 } from "../socle/contracts/pivot.v1";
import type { AccountMapping, FiscalCharge, TaxRate } from "../ports/repositories";

/** Décimales ISO 4217 (norme monétaire, pas une règle fiscale). */
const ISO_DECIMALS: Record<string, number> = { TND: 3, EUR: 2, USD: 2, LYD: 3, MAD: 2, XOF: 0 };

export function currencyDecimals(code: string): number {
  return ISO_DECIMALS[code.toUpperCase()] ?? 2;
}

export interface ProposalResult {
  pivot: PivotV1;
  extract: ExtractV1Type;
  journal: string;
  /**
   * Le libellé de l’écriture, composé.
   *
   * Il portait le seul nom de l’émetteur : deux factures du même fournisseur
   * dans le même mois donnaient deux écritures indiscernables en balance.
   * Il porte maintenant nature, contrepartie, référence et date — la forme que
   * SAF-T, le FEC et ISO 21378 demandent en substance.
   */
  libelle: string;
  lignes: Array<{
    account_code: string;
    libelle: string;
    debit: string;
    credit: string;
    tax_code: string | null;
  }>;
}

export function buildProposal(params: {
  pieceId: string;
  payload: unknown;
  taxRates: readonly TaxRate[];
  mappings: readonly AccountMapping[];
  fiscalCharges?: readonly FiscalCharge[];
  currency: string;
}): ProposalResult {
  const extract = ExtractV1.parse(params.payload);
  const decimals = currencyDecimals(extract.currency || params.currency);
  const firstTaxCode = extract.lines[0]?.tax_code ?? null;

  const mapping =
    params.mappings.find(
      (m) => m.documentKind === extract.document_kind && m.taxCode === firstTaxCode,
    ) ??
    params.mappings.find((m) => m.documentKind === extract.document_kind && m.taxCode === null) ??
    params.mappings.find((m) => m.documentKind === extract.document_kind);

  if (!mapping) throw new Error("MISSING_ACCOUNT_MAPPING");

  const pivot = computePivot({
    extract,
    source_item_id: params.pieceId,
    tenant_currency: { code: extract.currency, decimals },
    tax_rates: params.taxRates.map((r) => ({
      code: r.code,
      label: r.label,
      rate: r.rate,
      valid_from: r.validFrom,
      valid_to: r.validTo,
      jurisdiction: r.jurisdiction,
    })),
    mapping: {
      document_kind: extract.document_kind,
      charge_or_product_account: mapping.mainAccount,
      vat_account: mapping.vatAccount,
      counterparty_account: mapping.counterpartyAccount,
    },
    fiscal_charges: (params.fiscalCharges ?? [])
      .filter((c) => c.documentKind === extract.document_kind)
      .map((c) => ({
        code: c.code,
        label: c.label,
        account_code: c.accountCode,
        document_kind: c.documentKind,
        fixed_amount: c.fixedAmount,
      })),

    tolerances: {
      rounding_tolerance: (1 / 10 ** decimals).toFixed(decimals),
      confidence_orange: 0.7,
      confidence_red: 0.4,
    },
  });

  return {
    pivot,
    extract,
    journal: extract.document_kind === "facture_achat" ? "ACH" : "VEN",
    libelle: composerLibelle(faitsDuLibelle(extract)),
    // Une ligne nulle (TVA à zéro sur pièce exonérée) ne porte aucun fait
    // comptable : la base l'interdit, on ne la persiste pas. Le pivot du Socle
    // reste intact — c'est la seule vue persistée qui est filtrée.
    lignes: pivot.lines
      .filter((l) => Number(l.debit) !== 0 || Number(l.credit) !== 0)
      .map((l) => ({
        account_code: l.account_code,
        libelle: l.label,
        debit: l.debit,
        credit: l.credit,
        tax_code: l.account_code === mapping.vatAccount ? firstTaxCode : null,
      })),
  };
}
