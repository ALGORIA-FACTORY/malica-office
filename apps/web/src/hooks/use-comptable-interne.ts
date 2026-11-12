/**
 * Le comptable interne de la société ouverte (décision du 12 novembre 2026,
 * 7.2) : un salarié, membre de la société, qui en tient les livres.
 *
 * Une société qui en a un n'est plus « autonome » au sens où personne ne
 * valide : ses pièces partent chez lui, comme elles partiraient chez une
 * comptabilité externe. Les écrans qui décident où part un envoi lisent donc
 * `aUneComptabilite`, jamais le seul mandat. La base décide de même
 * (`app.livres_tenus_par_le_cabinet`).
 */
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

import { useMonCabinet } from "./use-mon-cabinet";

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

/**
 * Qui tient les livres de la société : la comptabilité mandatée, sinon le
 * comptable interne. `nom` : celui à qui la pièce part (`null` quand il n'a
 * pas de nom, l'écran dit alors son rôle).
 */
export function useComptabiliteDeLaSociete(tenantId: string | null | undefined) {
  const cabinet = useMonCabinet(tenantId);
  const place = usePlaceComptable(tenantId);
  const interne = place.data?.comptables[0] ?? null;
  return {
    cabinet,
    aUneComptabilite: Boolean(cabinet.data) || interne !== null,
    /** Le comptable interne en place, s'il n'y a pas de comptabilité mandatée. */
    interne: cabinet.data ? null : interne,
    pret: cabinet.isSuccess && (place.isSuccess || place.isError),
  };
}
