/**
 * Les notifications que le cabinet lit — UNE requête, partagée par le rail
 * (le badge) et l'écran des notifications.
 *
 * Le cabinet lit celles de ses clients ET les siennes : une révocation
 * s'inscrit chez lui, puisque le dossier du client lui devient invisible à
 * l'instant où le mandat se termine (recette du 21 octobre 2026, ANO-013).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { office } from "@/verticals/malica-office/composition";
import type { ClientSummary } from "@malica/socle/ports/repositories";

export function useNotificationsDuCabinet(
  cabinetId: string,
  clients: readonly ClientSummary[] | undefined,
) {
  const clientIds = useMemo(() => (clients ?? []).map((c) => c.tenantId), [clients]);
  const tenants = useMemo(() => [cabinetId, ...clientIds], [cabinetId, clientIds]);
  return useQuery({
    queryKey: ["cab-notifications", cabinetId, clientIds],
    queryFn: () => office().collab.notifications(tenants),
    enabled: clients !== undefined,
  });
}
