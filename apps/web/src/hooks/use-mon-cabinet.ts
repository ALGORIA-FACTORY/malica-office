/**
 * Le cabinet qui suit la société ouverte — le MANDAT ACTIF, pas
 * l'appartenance de la personne à un cabinet (recette du 20 octobre 2026).
 *
 * Une seule définition de la requête : six écrans la réécrivaient, avec la
 * même clé, et l'écran « Envoyé » a besoin du nom pour dire chez qui la pièce
 * est partie. Sans mandat, `data` vaut `null` et l'écran le dit autrement
 * plutôt que d'inventer un destinataire.
 */
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

const DIX_MINUTES = 10 * 60 * 1000;

export function cleMonCabinet(tenantId: string | null | undefined) {
  return ["mon-cabinet", tenantId] as const;
}

export function useMonCabinet(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: cleMonCabinet(tenantId),
    queryFn: () => office().identity.monCabinet(tenantId!),
    enabled: Boolean(tenantId),
    staleTime: DIX_MINUTES,
  });
}
