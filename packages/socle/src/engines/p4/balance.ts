/**
 * P4 — moteur d'équilibre : construit l'écriture depuis un extract.v1 et vérifie
 * Σdébit = Σcrédit STRICTEMENT (aucune conversion Number, aucun taux en dur).
 */
import { D, toFixedStr, sum } from "../../domain/decimal.ts";
import { resolveTaxRate } from "../../domain/tax-rates.ts";
import type {
  AccountMappingRule,
  CurrencyDef,
  TaxRateRow,
  Tolerances,
} from "../../domain/types.ts";
import type { ExtractV1 } from "../../contracts/extract.v1.ts";
import type { JournalLineV1, Motif, PivotV1 } from "../../contracts/pivot.v1.ts";
import { evaluateTrafficLight } from "./traffic-light.ts";

export interface FiscalChargeRule {
  code: string;
  label: string;
  account_code: string;
  /** Sens du document auquel le droit s'applique (null = les deux). */
  document_kind?: "facture_achat" | "facture_vente" | null;
  /** Montant fixe au pack (droit de timbre…), chaîne décimale ou null. */
  fixed_amount?: string | null;
}

export interface PivotInput {
  extract: ExtractV1;
  source_item_id: string | null;
  tenant_currency: CurrencyDef;
  tax_rates: readonly TaxRateRow[];
  mapping: AccountMappingRule;
  /** Droits et taxes hors TVA du pack (droit de timbre…) : compte par code. */
  fiscal_charges?: readonly FiscalChargeRule[];
  /**
   * Le compte de TVA par code de taxe, quand le pack en distingue.
   *
   * Sans cette table, le compte était celui du PREMIER code de taxe de la
   * pièce, pour toute la TVA — et le jour où un pack distingue l'imputation
   * par taux, la TVA du second taux partait sur le compte du premier.
   *
   * Facultative : un pack qui impute tous ses taux au même compte — c'est le
   * cas du pack tunisien — n'a rien à dire ici.
   */
  vat_accounts_by_tax_code?: Readonly<Record<string, string>>;
  tolerances: Tolerances;
}

export function computePivot(input: PivotInput): PivotV1 {
  const { extract, source_item_id, tenant_currency, tax_rates, mapping, tolerances } = input;
  const fiscalCharges = input.fiscal_charges ?? [];
  const decimals = tenant_currency.decimals;
  const motifs: Motif[] = [];
  const round = (s: string) => toFixedStr(D(s), decimals);

  // 1) Vérifier les taux applicables à la date.
  const perLineRate: Array<{ line: (typeof extract.lines)[number]; rate: TaxRateRow | null }> = [];
  for (const line of extract.lines) {
    const rate = resolveTaxRate(tax_rates, line.tax_code, extract.document_date);
    perLineRate.push({ line, rate });
    if (!rate) {
      motifs.push({
        code: "MISSING_TAX_RATE",
        severity: "block",
        message: `Aucun taux applicable à la date ${extract.document_date} pour ${line.tax_code}`,
        detail: { tax_code: line.tax_code, document_date: extract.document_date },
      });
    }
  }

  // 2) Vérifier cohérence taux ↔ montants (base × rate ≈ vat).
  for (const { line, rate } of perLineRate) {
    if (!rate) continue;
    const expected = D(line.base_ht).times(rate.rate);
    const diff = expected.minus(line.vat_amount).abs();
    if (diff.greaterThan(tolerances.rounding_tolerance)) {
      motifs.push({
        code: "TAX_RATE_MISMATCH",
        severity: "block",
        message: `TVA incohérente pour "${line.label}" : attendu ~${toFixedStr(expected, decimals)}, lu ${line.vat_amount}`,
        detail: {
          expected: toFixedStr(expected, decimals),
          actual: line.vat_amount,
          tax_code: line.tax_code,
          rate: rate.rate,
        },
      });
    }
  }

  // 3) Construire les lignes de journal (double-partie).
  const totalHT = sum(extract.lines.map((l) => l.base_ht));
  const totalVAT = sum(extract.lines.map((l) => l.vat_amount));

  /*
   * ============================================= LA TVA SE VENTILE PAR TAUX
   *
   * Vérification du 11 octobre 2026, « comme un expert-comptable » : le moteur
   * posait UNE ligne de TVA portant la somme de tous les taux, et la
   * proposition la timbrait du code de la PREMIÈRE ligne de la pièce.
   *
   * Sur une facture de restaurant — 7 % sur les plats, 19 % sur les boissons —
   * la totalité de la TVA se retrouvait déclarée à un seul taux. L'écriture
   * était équilibrée au millime, le contrôle de cohérence taux ↔ montants
   * passait (il travaille ligne par ligne), et rien ne signalait l'erreur. Elle
   * n'apparaissait qu'au moment de ventiler la TVA par taux, chez l'expert, un
   * mois plus tard et sans trace de son origine.
   *
   * Une ligne par code, donc, dans l'ordre d'apparition sur la pièce — l'ordre
   * décide du rendu, et deux bases doivent rendre la même écriture (R11).
   */
  const vatParCode: Array<{ code: string; montant: string; compte: string }> = [];
  for (const { line } of perLineRate) {
    const dejaVu = vatParCode.find((v) => v.code === line.tax_code);
    if (dejaVu) {
      dejaVu.montant = round(D(dejaVu.montant).plus(line.vat_amount).toString());
      continue;
    }
    vatParCode.push({
      code: line.tax_code,
      montant: round(line.vat_amount),
      compte: input.vat_accounts_by_tax_code?.[line.tax_code] ?? mapping.vat_account,
    });
  }

  // Droits et taxes hors TVA imprimés sur la pièce : le montant est lu (cité),
  // le compte vient du pack. Une charge sans compte au pack bloque l'écriture.
  const charges: Array<{ label: string; account_code: string; amount: string }> = [];
  for (const c of extract.other_charges ?? []) {
    const rule = fiscalCharges.find(
      (r) => r.code === c.code && (!r.document_kind || r.document_kind === extract.document_kind),
    );
    if (!rule) {
      motifs.push({
        code: "MISSING_ACCOUNT_MAPPING",
        severity: "block",
        message: `Aucun compte au pack pour le droit « ${c.code} »`,
        detail: { charge_code: c.code },
      });
      continue;
    }
    charges.push({
      label: c.label || rule.label,
      account_code: rule.account_code,
      amount: round(c.amount),
    });
  }

  // Résidu de pied de facture : TTC imprimé − (HT + TVA + droits déjà déclarés).
  // Les deux termes sont des montants cités ; l'attribution du résidu vient du
  // pack (droit à montant fixe), jamais d'une constante ni d'un modèle. Sans
  // correspondance au pack, l'écriture est bloquée : on n'invente aucun compte.
  const declared = sum(charges.map((c) => c.amount));
  const residual = D(extract.totals.ttc).minus(totalHT).minus(totalVAT).minus(declared);
  if (residual.abs().greaterThan(tolerances.rounding_tolerance)) {
    const match = fiscalCharges.find(
      (r) =>
        (!r.document_kind || r.document_kind === extract.document_kind) &&
        r.fixed_amount != null &&
        D(r.fixed_amount).equals(residual),
    );
    if (match) {
      charges.push({
        label: match.label,
        account_code: match.account_code,
        amount: round(residual.toString()),
      });
      motifs.push({
        code: "RESIDUAL_MATCHED_PACK_CHARGE",
        severity: "info",
        message: `Résidu ${toFixedStr(residual, decimals)} attribué au droit « ${match.code} » du pack`,
        detail: { charge_code: match.code, account_code: match.account_code },
      });
    } else {
      motifs.push({
        code: "RESIDUAL_UNEXPLAINED",
        severity: "block",
        message: `Résidu inexpliqué ${toFixedStr(residual, decimals)} entre le TTC imprimé et HT + TVA`,
        detail: {
          residual: toFixedStr(residual, decimals),
          printed_ttc: extract.totals.ttc,
          base_ht: toFixedStr(totalHT, decimals),
          vat: toFixedStr(totalVAT, decimals),
        },
      });
    }
  }

  const totalCharges = sum(charges.map((c) => c.amount));
  // La contrepartie se déduit des faits comptables (HT + TVA + droits) : elle ne
  // recopie jamais un TTC dont l'écart ne serait pas justifié.
  const counterparty = totalHT.plus(totalVAT).plus(totalCharges);

  const lines: JournalLineV1[] = [];
  if (extract.document_kind === "facture_achat") {
    lines.push({
      account_code: mapping.charge_or_product_account,
      label: extract.issuer,
      debit: round(totalHT.toString()),
      credit: "0",
    });
    for (const v of vatParCode) {
      lines.push({
        account_code: v.compte,
        label: `TVA déductible ${v.code}`,
        debit: v.montant,
        credit: "0",
        tax_code: v.code,
      });
    }
    for (const c of charges) {
      lines.push({ account_code: c.account_code, label: c.label, debit: c.amount, credit: "0" });
    }
    lines.push({
      account_code: mapping.counterparty_account,
      label: `Fournisseur ${extract.issuer}`,
      debit: "0",
      credit: round(counterparty.toString()),
    });
  } else {
    lines.push({
      account_code: mapping.counterparty_account,
      label: `Client ${extract.issuer}`,
      debit: round(counterparty.toString()),
      credit: "0",
    });
    for (const v of vatParCode) {
      lines.push({
        account_code: v.compte,
        label: `TVA collectée ${v.code}`,
        debit: "0",
        credit: v.montant,
        tax_code: v.code,
      });
    }
    lines.push({
      account_code: mapping.charge_or_product_account,
      label: extract.issuer,
      debit: "0",
      credit: round(totalHT.toString()),
    });
    for (const c of charges) {
      lines.push({ account_code: c.account_code, label: c.label, debit: "0", credit: c.amount });
    }
  }

  // 4) Vérifier l'équilibre STRICT (tolérance = 0 par défaut).
  const totalDebit = sum(lines.map((l) => l.debit));
  const totalCredit = sum(lines.map((l) => l.credit));
  const gap = totalDebit.minus(totalCredit).abs();
  if (gap.greaterThan(0)) {
    if (gap.lessThanOrEqualTo(tolerances.rounding_tolerance)) {
      motifs.push({
        code: "ROUNDING_WITHIN_TOLERANCE",
        severity: "warn",
        message: `Écart d'arrondi ${toFixedStr(gap, decimals)} ${tenant_currency.code}`,
        detail: { gap: toFixedStr(gap, decimals) },
      });
    } else {
      motifs.push({
        code: "UNBALANCED",
        severity: "block",
        message: `Déséquilibre : débit ${toFixedStr(totalDebit, decimals)} vs crédit ${toFixedStr(totalCredit, decimals)}`,
        detail: {
          debit: toFixedStr(totalDebit, decimals),
          credit: toFixedStr(totalCredit, decimals),
          gap: toFixedStr(gap, decimals),
        },
      });
    }
  }

  // 5) Confiance globale (min des champs si dispo).
  const confidences = Object.values(extract.field_confidence);
  const minConf = confidences.length > 0 ? Math.min(...confidences) : 1;
  if (minConf < tolerances.confidence_red) {
    motifs.push({
      code: "LOW_CONFIDENCE",
      severity: "block",
      message: `Confiance d'extraction ${minConf.toFixed(2)} < seuil rouge ${tolerances.confidence_red}`,
    });
  } else if (minConf < tolerances.confidence_orange) {
    motifs.push({
      code: "LOW_CONFIDENCE",
      severity: "warn",
      message: `Confiance d'extraction ${minConf.toFixed(2)} < seuil orange ${tolerances.confidence_orange}`,
    });
  }

  const traffic_light = evaluateTrafficLight(motifs);
  const period = extract.document_date.slice(0, 7);

  if (traffic_light === "VERT" && motifs.length === 0) {
    motifs.push({ code: "OK", severity: "info", message: "Écriture équilibrée et cohérente" });
  }

  return {
    contract: "pivot.v1",
    source_item_id,
    entry_date: extract.document_date,
    period,
    currency: extract.currency,
    lines,
    totals: { debit: toFixedStr(totalDebit, decimals), credit: toFixedStr(totalCredit, decimals) },
    traffic_light,
    motifs,
    approvable: traffic_light !== "ROUGE",
  };
}
