import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { usePme } from "@/components/malica/pme-context";
import { office } from "@/verticals/malica-office/composition";
import { computeTva } from "@malica/socle";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import type { TvaV1 } from "@malica/socle/contracts/tva.v1";
import { currencyDecimals } from "@malica/socle/use-cases/propose-ecriture";

export function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Le chiffre vient du Socle, jamais de l'écran : ce hook ne fait qu'assembler
 * les extraits comptabilisés et les taux gouvernés, puis invoque le moteur.
 */
export function useTvaPeriod(period: string): {
  tva: TvaV1 | null;
  count: number;
  isPending: boolean;
} {
  const pme = usePme();
  const { from, to } = monthBounds(period);

  const extracts = useQuery({
    queryKey: ["booked-extracts", pme.tenantId, from, to],
    queryFn: () => office().office.bookedExtracts(pme.tenantId, from, to),
  });

  const rates = useQuery({
    queryKey: ["tax-rates", pme.packId],
    queryFn: () => office().referential.taxRates(pme.packId!, pme.jurisdiction),
    enabled: !!pme.packId,
  });

  const tva = useMemo<TvaV1 | null>(() => {
    if (!extracts.data || !rates.data) return null;
    const achats: Array<{ item_id: string | null; extract: ExtractV1 }> = [];
    const ventes: Array<{ item_id: string | null; extract: ExtractV1 }> = [];
    for (const row of extracts.data) {
      const parsed = ExtractV1.safeParse(row.extract);
      if (!parsed.success) continue;
      const entry = { item_id: row.pieceId, extract: parsed.data };
      if (parsed.data.document_kind === "facture_vente") ventes.push(entry);
      else achats.push(entry);
    }
    return computeTva({
      period,
      currency: { code: pme.currency, decimals: currencyDecimals(pme.currency) },
      tax_rates: rates.data.map((r) => ({
        code: r.code,
        label: r.label,
        rate: r.rate,
        valid_from: r.validFrom,
        valid_to: r.validTo,
        jurisdiction: r.jurisdiction,
      })),
      achats,
      ventes,
    });
  }, [extracts.data, rates.data, period, pme.currency]);

  return {
    tva,
    count: extracts.data?.length ?? 0,
    isPending: extracts.isPending || rates.isPending,
  };
}
