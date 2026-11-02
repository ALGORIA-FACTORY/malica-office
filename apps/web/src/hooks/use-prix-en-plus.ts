/**
 * Ce que coûte une place ou une société au-delà de l'offre — lu dans la grille
 * (`public.mes_prix_en_plus`, 20261117120000), jamais écrit dans l'écran.
 *
 * Commerce seulement : la coque Android ne montre aucun prix (règles du
 * Play Store), et le serveur lui refuse cette méthode (`METHODES_COMMERCIALES`).
 * Sans licence dont on est titulaire, la base rend `null` et rien ne s'affiche.
 */
import { skipToken, useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

export function usePrixEnPlus(tenantId: string) {
  return useQuery({
    queryKey: ["prix-en-plus", tenantId],
    // `__COMMERCE__` et non `COMMERCE` : la constante de Vite est pliée avant
    // le découpage, et l'appel disparaît du paquet de la coque
    // (`outils/coque-sans-commerce.mjs`, `capabilities/coque.ts`).
    queryFn:
      __COMMERCE__ && tenantId.length > 0
        ? () => office().facturation.mesPrixEnPlus(tenantId)
        : skipToken,
  });
}
