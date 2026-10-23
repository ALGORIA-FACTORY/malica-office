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
  component: __COMMERCE__
    ? lazyRouteComponent(() => import("@/components/malica/payer-en-ligne"), "PayerEnLigneSociete")
    : () => null,
});
