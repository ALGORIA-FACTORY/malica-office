import type { ClientSummary } from "@malica/socle/ports/repositories";

/**
 * Le compte des mandats : UNE seule définition, lue par l'en-tête de la
 * comptabilité, le tableau de bord, le portail et le badge des clients. Un
 * mandat compte quand il est actif ; ni la proposition qui attend la société,
 * ni le mandat refusé ou terminé, ni l'archive en lecture seule (13 novembre
 * 2026, D1/G8).
 */
export function compterLesMandatsActifs(
  clients: readonly Pick<ClientSummary, "engagementStatus">[],
): number {
  return clients.filter((c) => c.engagementStatus === "actif").length;
}

/**
 * Les dossiers qu'on peut ouvrir : les mandats actifs, et l'archive en lecture
 * seule des mandats terminés où la comptabilité a travaillé. Un refus n'est pas
 * une archive (A6) : la société qui a refusé n'y figure jamais.
 */
export function dossiersAOuvrir<T extends Pick<ClientSummary, "engagementStatus" | "archive">>(
  clients: readonly T[],
): T[] {
  return clients.filter((c) => c.engagementStatus === "actif" || c.archive === true);
}

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
