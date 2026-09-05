import { D, toFixedStr } from "../../domain/decimal.ts";
import type { CurrencyDef } from "../../domain/types.ts";
import type { FxConversionV1, FxRateV1 } from "../../contracts/fx.v1.ts";

export class FxRateUnavailable extends Error {
  code = "FX_RATE_UNAVAILABLE" as const;
  constructor(public detail: { base: string; quote: string; date: string }) {
    super(`Aucun taux FX ${detail.base}→${detail.quote} au ${detail.date}`);
  }
}

/** Cherche un taux exact base→quote applicable à la date. Aucune approximation. */
export function findFxRate(
  rates: readonly FxRateV1[],
  base: string,
  quote: string,
  date: string,
): FxRateV1 | null {
  return (
    rates.find(
      (r) =>
        r.base === base &&
        r.quote === quote &&
        r.valid_from <= date &&
        (r.valid_to === null || r.valid_to >= date),
    ) ?? null
  );
}

export interface FxConvertInput {
  amount: string;
  from: CurrencyDef;
  to: CurrencyDef;
  date: string;
  rates: readonly FxRateV1[];
}

export function convertFx(input: FxConvertInput): FxConversionV1 {
  if (input.from.code === input.to.code) {
    return {
      contract: "fx.v1",
      amount_in: input.amount,
      currency_in: input.from.code,
      amount_out: toFixedStr(D(input.amount), input.to.decimals),
      currency_out: input.to.code,
      rate_used: "1",
      rate_date: input.date,
    };
  }
  const rate = findFxRate(input.rates, input.from.code, input.to.code, input.date);
  if (!rate) {
    throw new FxRateUnavailable({ base: input.from.code, quote: input.to.code, date: input.date });
  }
  const out = D(input.amount).times(rate.rate);
  return {
    contract: "fx.v1",
    amount_in: input.amount,
    currency_in: input.from.code,
    amount_out: toFixedStr(out, input.to.decimals),
    currency_out: input.to.code,
    rate_used: rate.rate,
    rate_date: input.date,
  };
}
