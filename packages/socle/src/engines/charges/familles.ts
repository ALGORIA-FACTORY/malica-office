/**
 * Moteur des charges par famille — TypeScript pur : aucune base, aucun réseau,
 * aucun seuil ni libellé en dur. Les familles, leur ordre et les seuils
 * d'anomalie viennent du pack ; les montants viennent d'articles cités.
 */
import { D, toFixedStr, sum, Decimal } from "../../domain/decimal.ts";

export interface FamilleDef {
  code: string;
  label: string;
  ordinal: number;
  isFallback: boolean;
}

export interface ArticleFact {
  pieceId: string;
  ordinal: number;
  designation: string;
  quantity: string | null;
  unitPriceHt: string | null;
  unitPriceTtc: string | null;
  totalHt: string | null;
  familleCode: string;
  period: string; // YYYY-MM
  documentDate: string | null;
  citationField: string | null;
}

export interface AnomalyThreshold {
  code: string;
  minPeriods: number;
  deviationRatio: string;
  minAmount: string;
}

export interface FamilleTotal {
  code: string;
  label: string;
  ordinal: number;
  total: string;
  share: string; // part du total de la période, 0..1
  articles: number;
  quantity: string;
}

export interface FamilleAnomaly {
  familleCode: string;
  label: string;
  period: string;
  observed: string;
  baseline: string;
  deviationRatio: string;
  thresholdCode: string;
  periodsUsed: number;
}

export interface ChargesByFamilleInput {
  articles: readonly ArticleFact[];
  familles: readonly FamilleDef[];
  period: string;
  /** Périodes de référence (les plus récentes d'abord), hors période courante. */
  baselinePeriods: readonly string[];
  threshold: AnomalyThreshold | null;
  decimals: number;
}

export interface ChargesByFamilleResult {
  period: string;
  total: string;
  previousTotal: string | null;
  /** Évolution vs période précédente (chaîne décimale signée) ou null. */
  evolution: string | null;
  familles: FamilleTotal[];
  anomalies: FamilleAnomaly[];
}

function amountOf(a: ArticleFact): Decimal {
  if (a.totalHt) return D(a.totalHt);
  if (a.quantity && a.unitPriceHt) return D(a.quantity).times(a.unitPriceHt);
  return D(0);
}

function median(values: readonly Decimal[]): Decimal {
  if (values.length === 0) return D(0);
  const sorted = [...values].sort((x, y) => (x.lessThan(y) ? -1 : x.greaterThan(y) ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return sorted[mid - 1]!.plus(sorted[mid]!).dividedBy(2);
}

/** Total par famille et par période, plus écarts inhabituels selon le pack. */
export function computeChargesByFamille(input: ChargesByFamilleInput): ChargesByFamilleResult {
  const { articles, familles, period, baselinePeriods, threshold, decimals } = input;
  const byCode = new Map(familles.map((f) => [f.code, f]));
  const fallback = familles.find((f) => f.isFallback) ?? null;

  const labelOf = (code: string) => byCode.get(code)?.label ?? fallback?.label ?? code;
  const ordinalOf = (code: string) => byCode.get(code)?.ordinal ?? 999;

  // Agrégats de la période courante.
  const current = articles.filter((a) => a.period === period);
  const totals = new Map<string, { amount: Decimal; count: number; qty: Decimal }>();
  for (const a of current) {
    const key = a.familleCode;
    const acc = totals.get(key) ?? { amount: D(0), count: 0, qty: D(0) };
    acc.amount = acc.amount.plus(amountOf(a));
    acc.count += 1;
    acc.qty = acc.qty.plus(a.quantity ?? 0);
    totals.set(key, acc);
  }

  const total = sum([...totals.values()].map((v) => v.amount));

  const familleTotals: FamilleTotal[] = [...totals.entries()]
    .map(([code, v]) => ({
      code,
      label: labelOf(code),
      ordinal: ordinalOf(code),
      total: toFixedStr(v.amount, decimals),
      share: total.isZero() ? "0" : v.amount.dividedBy(total).toDecimalPlaces(4).toString(),
      articles: v.count,
      quantity: toFixedStr(v.qty, 3),
    }))
    .sort((a, b) =>
      D(b.total).greaterThan(a.total)
        ? 1
        : D(b.total).lessThan(a.total)
          ? -1
          : a.ordinal - b.ordinal,
    );

  // Total de la période précédente immédiate, si disponible.
  const previousPeriod = baselinePeriods[0] ?? null;
  const previousAmounts = previousPeriod
    ? articles.filter((a) => a.period === previousPeriod).map((a) => amountOf(a))
    : [];
  const previousTotal = previousPeriod ? sum(previousAmounts) : null;
  const evolution =
    previousTotal && !previousTotal.isZero()
      ? total.minus(previousTotal).dividedBy(previousTotal).toDecimalPlaces(4).toString()
      : null;

  // Écarts inhabituels : base = médiane des périodes de référence du pack.
  const anomalies: FamilleAnomaly[] = [];
  if (threshold && baselinePeriods.length >= threshold.minPeriods) {
    for (const [code, v] of totals.entries()) {
      const history = baselinePeriods.map((p) =>
        sum(
          articles.filter((a) => a.period === p && a.familleCode === code).map((a) => amountOf(a)),
        ),
      );
      const nonEmpty = history.filter((h) => !h.isZero());
      if (nonEmpty.length < threshold.minPeriods) continue;
      const base = median(nonEmpty);
      if (base.isZero()) continue;
      if (v.amount.lessThan(threshold.minAmount)) continue;
      const ratio = v.amount.minus(base).dividedBy(base);
      if (ratio.abs().greaterThanOrEqualTo(threshold.deviationRatio)) {
        anomalies.push({
          familleCode: code,
          label: labelOf(code),
          period,
          observed: toFixedStr(v.amount, decimals),
          baseline: toFixedStr(base, decimals),
          deviationRatio: ratio.toDecimalPlaces(4).toString(),
          thresholdCode: threshold.code,
          periodsUsed: nonEmpty.length,
        });
      }
    }
  }
  anomalies.sort((a, b) =>
    D(b.deviationRatio).abs().greaterThan(D(a.deviationRatio).abs()) ? 1 : -1,
  );

  return {
    period,
    total: toFixedStr(total, decimals),
    previousTotal: previousTotal ? toFixedStr(previousTotal, decimals) : null,
    evolution,
    familles: familleTotals,
    anomalies,
  };
}
