import { useQuery } from "@tanstack/react-query";

import { useCabinet } from "@/components/malica/cabinet-context";
import { office } from "@/verticals/malica-office/composition";

import { currentPeriod } from "./use-tva";

/**
 * Le mois en cours AU CABINET (`AAAA-MM`), au fuseau qu'il a arrêté
 * (`cabinet_fuseau_lire`) — celui du journal du jour. Côté PME, le mois est
 * celui du lecteur ; côté cabinet, celui du cabinet : un comptable en
 * déplacement ne change pas de mois de travail (revue de #140). Tant que le
 * fuseau n'est pas lu, le mois du poste.
 */
export function useMoisDuCabinet(): string {
  const { org } = useCabinet();
  const fuseau = useQuery({
    queryKey: ["cab-fuseau", org.id],
    queryFn: () => office().parametrage.fuseauDuCabinet(org.id),
    staleTime: 10 * 60 * 1000,
  });
  return fuseau.data?.aujourdhui?.slice(0, 7) ?? currentPeriod();
}
