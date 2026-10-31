/**
 * Qui je suis dans cette organisation, et ce que le référentiel m'y ouvre
 * (`acces.monAcces` : le rôle, la plateforme, les droits).
 *
 * Une seule définition de la requête : dix écrans la réécrivaient, sous trois
 * clés différentes (« mon-acces », « pme-acces », « cab-acces ») — trois
 * lectures du même fait, et un changement de rôle que deux écrans ignoraient.
 *
 * Les droits (lot 4, « Malica sans blocage ») décident de ce que l'écran
 * MONTRE — « Envoyer » au propriétaire ou au comptable, « Garder »,
 * « Retourner » au siège. Ils ne décident de rien : chaque porte de la base
 * refait le contrôle.
 */
import type { Droit, MonAcces } from "@malica/socle/ports/repositories";
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

const DIX_MINUTES = 10 * 60 * 1000;

export function useMonAcces(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["mon-acces", tenantId] as const,
    queryFn: () => office().acces.monAcces(tenantId!),
    enabled: Boolean(tenantId),
    staleTime: DIX_MINUTES,
  });
}

/** Le droit est-il ouvert ? Faux tant que l'accès n'est pas lu : rien n'est promis. */
export function aLeDroit(acces: MonAcces | null | undefined, droit: Droit): boolean {
  return acces?.droits.includes(droit) ?? false;
}
