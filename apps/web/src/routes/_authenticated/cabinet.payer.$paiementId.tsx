/**
 * Le moyen de paiement, côté cabinet — l'adresse qui ouvre le choix pour régler une facture.
 *
 * Route fine : elle ne porte que l'adresse et les titres de page, et charge à la demande
 * le composant `PayerEnLigneCabinet`, qui partage sa logique avec l'écran de la société.
 * Payer, c'est vendre : dans l'application Android (`COMMERCE` faux), la route renvoie au
 * cabinet et le composant n'entre même pas dans le paquet.
 */
import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";

import { COMMERCE } from "@/capabilities/coque";

export const Route = createFileRoute("/_authenticated/cabinet/payer/$paiementId")({
  head: () => ({
    meta: [
      { title: "Moyen de paiement — Malica Office" },
      { name: "description", content: "Choisir comment régler une facture de la comptabilité." },
      { property: "og:title", content: "Moyen de paiement — Malica Office" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Payer, c'est vendre : pas dans l'application Android (`COMMERCE`).
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/cabinet" });
  },
  /*
   * Une autre pièce, un autre écran : sans cela, le routeur garde le
   * composant et son état d'une pièce à l'autre (« Validée » affiché sur la
   * suivante, boutons disparus — audit du 27 octobre 2026).
   */
  remountDeps: ({ params }) => params,
  component: __COMMERCE__
    ? lazyRouteComponent(() => import("@/components/malica/payer-en-ligne"), "PayerEnLigneCabinet")
    : () => null,
});
