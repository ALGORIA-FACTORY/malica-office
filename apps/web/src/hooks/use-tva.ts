import { finDuMois } from "@malica/socle/exercice";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { usePme } from "@/components/malica/pme-context";
import { useDecimales } from "./use-decimales";
import { office } from "@/verticals/malica-office/composition";
import { computeTva } from "@malica/socle";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import type { TvaV1 } from "@malica/socle/contracts/tva.v1";

export function monthBounds(period: string): { from: string; to: string } {
  // Le dernier jour du mois vient du Socle : il y était déjà, calculé de la
  // même façon et couvert par ses propres épreuves, et six fichiers
  // l'importaient pendant que celui-ci le recalculait.
  return { from: `${period}-01`, to: finDuMois(period) };
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
  // Les décimales viennent du pack (R4) : sans elles, aucun montant n'est
  // écrivable, et mieux vaut ne rien rendre qu'un chiffre à la mauvaise
  // échelle.
  const decimales = useDecimales();
  const { from, to } = monthBounds(period);

  // La TVA du mois est celle des pièces TRANSMISES ce mois-là : le cabinet
  // ne déclare que ce qu'il a reçu, et une pièce gardée au coffre n'entre
  // dans aucune déclaration. Décision du commanditaire du 10 octobre 2026.
  const extracts = useQuery({
    queryKey: ["extraits-transmis", pme.tenantId, from, to],
    queryFn: () => office().office.extraitsTransmis(pme.tenantId, from, to),
  });

  const rates = useQuery({
    queryKey: ["tax-rates", pme.packId],
    queryFn: () => office().referential.taxRates(pme.packId!, pme.jurisdiction),
    enabled: !!pme.packId,
  });

  const tva = useMemo<TvaV1 | null>(() => {
    if (!extracts.data || !rates.data || decimales === null) return null;
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
      currency: { code: pme.currency, decimals: decimales },
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
  }, [extracts.data, rates.data, decimales, period, pme.currency]);

  return {
    tva,
    count: extracts.data?.length ?? 0,
    isPending: extracts.isPending || rates.isPending,
  };
}
