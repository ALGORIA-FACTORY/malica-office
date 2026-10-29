/**
 * Le journal du jour : les appels par `/rpc`, et le fichier GARDÉ d'un export
 * par sa propre route (`/exports/:id/contenu`) — un flux binaire n'a pas sa
 * place dans un appel JSON, comme les octets d'une pièce (`capture.ts`).
 */
import type { JournalDuJourRepository } from "@malica/socle/ports/repositories";

import { transport } from "@/lib/transport";
import { ErreurApi } from "@/lib/transport/erreurs";
import { appeler } from "./rpc";

export function creerJournalDuJourHttp(): JournalDuJourRepository {
  return {
    lire: (cabinet, client, jour, locale) =>
      appeler("journalDuJour", "lire", [cabinet, client, jour, locale]) as ReturnType<
        JournalDuJourRepository["lire"]
      >,
    exporter: (cabinet, client, jour, locale, format) =>
      appeler("journalDuJour", "exporter", [cabinet, client, jour, locale, format]) as ReturnType<
        JournalDuJourRepository["exporter"]
      >,
    async fichier(exportId) {
      // Avec la session : un export n'est pas public, et une URL nue
      // n'emporterait ni cookie ni jeton.
      const reponse = await transport().appeler(`/exports/${exportId}/contenu`);
      if (!reponse.ok) {
        const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
        throw new ErreurApi(corps?.erreur ?? "export introuvable", reponse.status);
      }
      return reponse.blob();
    },
  };
}
