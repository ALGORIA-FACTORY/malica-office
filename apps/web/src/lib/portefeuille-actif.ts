import type { ClientSummary } from "@malica/socle/ports/repositories";

/** Le périmètre opérationnel du cabinet : les mandats actifs, même pour un opérateur. */
export function idsDesMandatsActifs(
  clients: readonly Pick<ClientSummary, "tenantId" | "engagementStatus">[],
): Set<string> {
  return new Set(clients.filter((c) => c.engagementStatus === "actif").map((c) => c.tenantId));
}

/** Un regroupement d'affichage ; aucune date d'obligation n'est dérivée ici. */
export function trancheDEcheance(
  date: string,
  aujourdHui: string,
): "retard" | "semaine" | "mois" | "suite" {
  const jours = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${aujourdHui}T00:00:00Z`)) / 86_400_000,
  );
  return jours < 0 ? "retard" : jours <= 7 ? "semaine" : jours <= 30 ? "mois" : "suite";
}
