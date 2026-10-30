import { finDuMois } from "@malica/socle/exercice";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { moisLocal } from "@/lib/lisible";
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

/** Le mois en cours, à l'heure du lecteur : à minuit à Tunis, le 1er est déjà le mois suivant. */
export function currentPeriod(): string {
  return moisLocal(new Date());
}

type Entree = { item_id: string | null; extract: ExtractV1 };

/**
 * Les extraits du mois, rangés pour le moteur : achats, ventes — et ceux qui
 * ne se lisent pas. Une pièce dont l'extrait ne valide pas (un taux manquant
 * sur une ligne forcée, revue de #140) n'est jamais écartée en silence : elle
 * est « refusée », avec ce qui manque, et l'écran la compte.
 */
export function extraitsDeLaTva(rows: ReadonlyArray<{ pieceId: string; extract: unknown }>) {
  const achats: Entree[] = [];
  const ventes: Entree[] = [];
  const illisibles: TvaV1["refused"] = [];
  for (const row of rows) {
    const parsed = ExtractV1.safeParse(row.extract);
    if (!parsed.success) {
      const champs = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].sort();
      illisibles.push({ reason: `EXTRAIT_ILLISIBLE:${champs.join(",")}`, item_id: row.pieceId });
      continue;
    }
    const entree = { item_id: row.pieceId, extract: parsed.data };
    if (parsed.data.document_kind === "facture_vente") ventes.push(entree);
    else achats.push(entree);
  }
  return { achats, ventes, illisibles };
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
  const { locale } = useI18n();
  // Les décimales viennent du pack (R4) : sans elles, aucun montant n'est
  // écrivable, et mieux vaut ne rien rendre qu'un chiffre à la mauvaise
  // échelle.
  const decimales = useDecimales();
  const { from, to } = monthBounds(period);

  // La TVA du mois est celle des pièces TRANSMISES ce mois-là : le cabinet
  // ne déclare que ce qu'il a reçu, et une pièce gardée au coffre n'entre
  // dans aucune déclaration. Décision du commanditaire du 10 octobre 2026.
  //
  // SANS comptabilité mandatée (20 octobre 2026, recette) : rien n'est
  // jamais transmis, et la TVA restait à zéro malgré des factures confirmées
  // et comptabilisées. Le dirigeant qui tient lui-même ses comptes déclare ce
  // qu'il a comptabilisé : ce sont alors les pièces comptabilisées du mois.
  const extracts = useQuery({
    queryKey: [
      pme.aUnCabinet ? "extraits-transmis" : "extraits-comptabilises",
      pme.tenantId,
      from,
      to,
    ],
    queryFn: () =>
      pme.aUnCabinet
        ? office().office.extraitsTransmis(pme.tenantId, from, to)
        : office().office.bookedExtracts(pme.tenantId, from, to),
  });

  const rates = useQuery({
    // La langue entre dans la cle : les libelles des taux sont traduits, et
    // un cache commun aurait servi l arabe a un ecran francais.
    queryKey: ["tax-rates", pme.packId, locale],
    queryFn: () => office().referential.taxRates(pme.packId!, pme.jurisdiction, locale),
    enabled: !!pme.packId,
  });

  const tva = useMemo<TvaV1 | null>(() => {
    if (!extracts.data || !rates.data || decimales === null) return null;
    const { achats, ventes, illisibles } = extraitsDeLaTva(extracts.data);
    const calcul = computeTva({
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
    return { ...calcul, refused: [...illisibles, ...calcul.refused] };
  }, [extracts.data, rates.data, decimales, period, pme.currency]);

  return {
    tva,
    count: extracts.data?.length ?? 0,
    isPending: extracts.isPending || rates.isPending,
  };
}
