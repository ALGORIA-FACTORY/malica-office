/**
 * Les plantages — Sentry, dans la coque, et rien de plus.
 *
 * ============================================================== POURQUOI
 *
 * Un défaut qui n'existe que sur un téléphone à trois gigaoctets, un
 * vendredi soir, ne se reproduit pas sur le poste. Le journal d'atelier
 * (`journal-atelier.ts`) sert en développement, sur le même réseau ; ici,
 * c'est le pilote : dix PME, des appareils qu'on n'a jamais vus, et la pile
 * qui doit arriver toute seule.
 *
 * ================================================== CE QUI NE PART JAMAIS
 *
 * Une pièce est un document de client. Rien de ce qui pourrait en porter un
 * morceau ne quitte l'appareil : ni corps de requête, ni en-tête, ni cookie,
 * ni message de console, ni adresse IP (`sendDefaultPii: false`). Ce qui
 * part : la pile, l'écran, la version, le canal, et l'identifiant du dossier
 * — un uuid, pour regrouper, pas pour nommer. `preparerEvenement` et
 * `preparerFilDAriane` sont des fonctions pures, testées : la promesse est
 * tenue par le code, pas par une case dans une console.
 *
 * La coque seulement : dans un navigateur, `estNatif()` est faux et rien ne
 * démarre ; hors du bundle de coque, `CIBLE_COQUE` est faux et rien n'entre
 * dans le paquet. Sans DSN (`VITE_SENTRY_DSN`, dans `.env.coque-<cible>`),
 * rien ne démarre non plus.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/react";

import { CIBLE_COQUE, estNatif, versionClient } from "@/capabilities/coque";

/** Le canal de la cible : staging, pilote, production — « atelier » sans build de coque. */
export const CANAL = (import.meta.env["VITE_CANAL_OTA"] as string | undefined) ?? "atelier";

const DSN = (import.meta.env["VITE_SENTRY_DSN"] as string | undefined) ?? "";

/** La version du dépôt, posée au build ; « 0.0.0 » dans l'atelier. */
const VERSION = (import.meta.env["VITE_VERSION_CLIENT"] as string | undefined) ?? "0.0.0";

/**
 * Un fil d'Ariane, réduit à ce qui aide : pour un appel réseau, l'adresse, la
 * méthode et le statut — jamais un corps. Les messages de console ne passent
 * pas : ils pourraient porter n'importe quoi.
 */
export function preparerFilDAriane(fil: Breadcrumb): Breadcrumb | null {
  if (fil.category === "console") return null;
  if (fil.category === "fetch" || fil.category === "xhr") {
    const donnees = fil.data ?? {};
    return {
      ...fil,
      data: {
        url: donnees["url"],
        method: donnees["method"],
        status_code: donnees["status_code"],
      },
    };
  }
  return fil;
}

/**
 * L'événement, avant qu'il parte : la requête réduite à son adresse, aucun
 * utilisateur, et les fils d'Ariane passés au même tamis.
 */
export function preparerEvenement<E extends ErrorEvent>(evenement: E): E {
  if (evenement.request) {
    const { url } = evenement.request;
    evenement.request = url === undefined ? {} : { url };
  }
  delete evenement.user;
  if (evenement.breadcrumbs) {
    evenement.breadcrumbs = evenement.breadcrumbs
      .map(preparerFilDAriane)
      .filter((fil): fil is Breadcrumb => fil !== null);
  }
  return evenement;
}

let demarree = false;

/** Démarre Sentry dans la coque — une fois, et seulement s'il y a un DSN. */
export async function demarrerLaTelemetrie(): Promise<boolean> {
  if (demarree || !CIBLE_COQUE || !DSN || typeof window === "undefined" || !estNatif()) {
    return false;
  }
  demarree = true;
  const [Sentry, SentryReact] = await Promise.all([
    import("@sentry/capacitor"),
    import("@sentry/react"),
  ]);
  Sentry.init(
    {
      dsn: DSN,
      // Une version Sentry ne porte pas de barre oblique : « malica-coque@0.3.1 ».
      release: `malica-coque@${VERSION}`,
      environment: CANAL,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: (evenement) => preparerEvenement(evenement),
      beforeBreadcrumb: (fil) => preparerFilDAriane(fil),
      initialScope: { tags: { client: versionClient(), canal: CANAL } },
    },
    SentryReact.init,
  );
  return true;
}

/** Le dossier ouvert — un uuid, pour regrouper les plantages par PME. */
export function etiqueterLeDossier(tenantId: string | null): void {
  if (!demarree) return;
  void import("@sentry/capacitor").then((Sentry) => Sentry.setTag("dossier", tenantId ?? ""));
}
