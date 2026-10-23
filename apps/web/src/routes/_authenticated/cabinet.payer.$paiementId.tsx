import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";

import { COMMERCE } from "@/capabilities/coque";

export const Route = createFileRoute("/_authenticated/cabinet/payer/$paiementId")({
  head: () => ({
    meta: [
      { title: "Moyen de paiement — Malica Office" },
      { name: "description", content: "Choisir comment régler une facture du cabinet." },
      { property: "og:title", content: "Moyen de paiement — Malica Office" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Payer, c'est vendre : pas dans l'application Android (`COMMERCE`).
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/cabinet" });
  },
  component: __COMMERCE__
    ? lazyRouteComponent(() => import("@/components/malica/payer-en-ligne"), "PayerEnLigneCabinet")
    : () => null,
});
