/**
 * Proposer une offre à un client, depuis l'import ou les actions en lot.
 * Un module du web seulement : on ne l'atteint que par `import()` sous
 * `__COMMERCE__`, et il n'entre pas dans le paquet de l'application installée.
 */
import { office } from "@/verticals/malica-office/composition";

export function proposerAbonnement(cabinetId: string, clientId: string, offre: string) {
  return office().facturation.proposerAbonnement(cabinetId, clientId, offre);
}
