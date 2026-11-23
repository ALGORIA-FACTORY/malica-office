/**
 * La dernière invitation de la comptabilité d'une société — une seule lecture, sous une
 * seule clé, pour Réglages › Sociétés et pour la suite de l'arrivée.
 */
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

export const cleInvitation = (tenantId: string) =>
  ["invitation-de-ma-comptabilite", tenantId] as const;

export function useInvitationDeMaComptabilite(tenantId: string) {
  return useQuery({
    queryKey: cleInvitation(tenantId),
    queryFn: () => office().identity.invitationDeMaComptabilite(tenantId),
  });
}
