/**
 * Ce que coûte une place ou une société au-delà de l'offre — lu dans la grille
 * (`public.mes_prix_en_plus`, 20261117120000), jamais écrit dans l'écran.
 *
 * Commerce seulement : la coque Android ne montre aucun prix (règles du
 * Play Store), et le serveur lui refuse cette méthode (`METHODES_COMMERCIALES`).
 * Sans licence dont on est titulaire, la base rend `null` et rien ne s'affiche.
 */
import { useQuery } from "@tanstack/react-query";

import { COMMERCE } from "@/capabilities/coque";
import { office } from "@/verticals/malica-office/composition";

export function usePrixEnPlus(tenantId: string) {
  return useQuery({
    queryKey: ["prix-en-plus", tenantId],
    queryFn: () => office().facturation.mesPrixEnPlus(tenantId),
    enabled: COMMERCE && tenantId.length > 0,
  });
}
