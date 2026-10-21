/**
 * Le dossier est-il assujetti à la TVA ? La fiche fiscale en vigueur le dit,
 * et rien d'autre (recette du 21 octobre 2026, ANO-LIVE-001) : une épicerie
 * au forfait, non assujettie, lisait « TVA récupérable » et un « crédit de
 * TVA » qu'elle n'a pas.
 *
 * `null` tant que la fiche n'est pas lue, ou si elle ne dit rien : l'écran
 * garde alors son discours ordinaire, il ne devine pas.
 */
import { useQuery } from "@tanstack/react-query";

import { usePme } from "@/components/malica/pme-context";
import { office } from "@/verticals/malica-office/composition";

export function useNonAssujetti(): boolean | null {
  const pme = usePme();
  // La même clé que la liste des clients du cabinet : une fiche, une lecture.
  const fiche = useQuery({
    queryKey: ["fiche", pme.tenantId],
    queryFn: () => office().identity.ficheCourante(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });
  const regime = fiche.data?.regimeTva ?? null;
  return regime === null ? null : regime === "non_assujetti";
}
