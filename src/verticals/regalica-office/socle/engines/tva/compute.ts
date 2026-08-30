import { D, sum, toFixedStr } from "../../domain/decimal";
import { resolveTaxRate } from "../../domain/tax-rates";
import type { CurrencyDef, TaxRateRow } from "../../domain/types";
import type { ExtractV1 } from "../../contracts/extract.v1";
import type { TvaV1 } from "../../contracts/tva.v1";

export interface TvaInput {
  period: string; // "YYYY-MM"
  currency: CurrencyDef;
  tax_rates: readonly TaxRateRow[];
  achats: ReadonlyArray<{ item_id: string | null; extract: ExtractV1 }>;
  ventes: ReadonlyArray<{ item_id: string | null; extract: ExtractV1 }>;
}

function bucketize(
  items: ReadonlyArray<{ item_id: string | null; extract: ExtractV1 }>,
  rates: readonly TaxRateRow[],
  refused: TvaV1["refused"],
) {
  const map = new Map<string, { rate: string; base: string; vat: string }>();
  for (const { item_id, extract } of items) {
    for (const line of extract.lines) {
      const rate = resolveTaxRate(rates, line.tax_code, extract.document_date);
      if (!rate) {
        refused.push({
          reason: `MISSING_TAX_RATE:${line.tax_code}@${extract.document_date}`,
          item_id,
        });
        continue;
      }
      const cur = map.get(line.tax_code) ?? { rate: rate.rate, base: "0", vat: "0" };
      cur.base = D(cur.base).plus(line.base_ht).toString();
      cur.vat = D(cur.vat).plus(line.vat_amount).toString();
      map.set(line.tax_code, cur);
    }
  }
  return Array.from(map.entries()).map(([tax_code, v]) => ({ tax_code, ...v }));
}

export function computeTva(input: TvaInput): TvaV1 {
  const refused: TvaV1["refused"] = [];
  const collectee = bucketize(input.ventes, input.tax_rates, refused);
  const deductible = bucketize(input.achats, input.tax_rates, refused);
  const dec = input.currency.decimals;
  const totCol = sum(collectee.map((b) => b.vat));
  const totDed = sum(deductible.map((b) => b.vat));
  const solde = totCol.minus(totDed);
  return {
    contract: "tva.v1",
    period: input.period,
    currency: input.currency.code,
    collectee: collectee.map((b) => ({
      ...b,
      base: toFixedStr(D(b.base), dec),
      vat: toFixedStr(D(b.vat), dec),
    })),
    deductible: deductible.map((b) => ({
      ...b,
      base: toFixedStr(D(b.base), dec),
      vat: toFixedStr(D(b.vat), dec),
    })),
    totals: {
      collectee: toFixedStr(totCol, dec),
      deductible: toFixedStr(totDed, dec),
      solde: toFixedStr(solde, dec),
    },
    refused,
  };
}
