/**
 * Le moyen de paiement (PME) — l'écran où le dirigeant choisit comment régler en ligne.
 *
 * Route `/pme/payer/$paiementId`, côté société. Payer, c'est vendre : l'écran n'existe pas
 * dans l'application Android. La constante `COMMERCE` renvoie alors aux réglages, et la page
 * est chargée en différé sous `__COMMERCE__`, pour que son code quitte le paquet de la coque.
 * Le composant (`payer-en-ligne`) est partagé avec la route du cabinet, qui garde son habillage.
 *
 * `remountDeps` remonte l'écran à chaque paiement : sans lui, le routeur garderait l'état du
 * précédent (« Validée » affiché sur le suivant, boutons disparus).
 */
import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";

import { COMMERCE } from "@/capabilities/coque";

export const Route = createFileRoute("/_authenticated/pme/payer/$paiementId")({
  head: () => ({
    meta: [
      { title: "Moyen de paiement — Malica Office" },
      { name: "description", content: "Choisir comment régler un paiement en ligne." },
      { property: "og:title", content: "Moyen de paiement — Malica Office" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Payer, c'est vendre : pas dans l'application Android (`COMMERCE`). La page
  // est chargée en différé et sous la constante : son import quitte le paquet
  // de la coque, et une adresse tapée ramène aux réglages.
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/pme/reglages" });
  },
  /*
   * Une autre pièce, un autre écran : sans cela, le routeur garde le
   * composant et son état d'une pièce à l'autre (« Validée » affiché sur la
   * suivante, boutons disparus — audit du 27 octobre 2026).
   */
  remountDeps: ({ params }) => params,
  component: __COMMERCE__
    ? lazyRouteComponent(() => import("@/components/malica/payer-en-ligne"), "PayerEnLigneSociete")
    : () => null,
});
