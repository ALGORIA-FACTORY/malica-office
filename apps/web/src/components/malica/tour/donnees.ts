/**
 * Les lectures de la tour que plusieurs écrans partagent : une requête, une
 * clé. La liste des cabinets, la fiche d'un cabinet et la liste des PME lisent
 * la même photographie (`tour.clients`) — trois écrans, un aller-retour.
 */
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

export const CLE_CLIENTS = ["tour-clients"] as const;

export function useClientsDeLaTour() {
  return useQuery({ queryKey: CLE_CLIENTS, queryFn: () => office().tour.clients() });
}

/** Une date « AAAA-MM-JJ » de la base, dans la langue du lecteur ; « — » sans date. */
export function dateCourte(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}
