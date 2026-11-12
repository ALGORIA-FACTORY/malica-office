/**
 * La place « Comptable interne » de la société ouverte (décision du 12 novembre
 * 7.2) : comprise, prise, attendue. Jamais un prix.
 *
 * Ce hook ne fait PAS partir les pièces vers le comptable interne : il n'a pas
 * encore d'espace de travail (revue de #369). Tant que cet espace n'existe pas,
 * l'envoi, le circuit et la capture ne lisent que le MANDAT d'une comptabilité
 * (`useMonCabinet`), comme sur `main`.
 */
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

const DIX_MINUTES = 10 * 60 * 1000;

export function clePlaceComptable(tenantId: string | null | undefined) {
  return ["place-comptable", tenantId] as const;
}

/** La place « Comptable interne » : comprise, prise, attendue. Jamais un prix. */
export function usePlaceComptable(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: clePlaceComptable(tenantId),
    queryFn: () => office().facturation.placeComptable(tenantId!),
    enabled: Boolean(tenantId),
    staleTime: DIX_MINUTES,
  });
}
