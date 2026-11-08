/**
 * Abonnements — la comptabilité revendeur (règles du 20 octobre 2026).
 *
 * L'écran vit dans `components/malica/abonnements-du-cabinet.tsx` depuis le
 * 2 novembre 2026 : la tour montre le même, en lecture. Il se charge en
 * différé derrière `__COMMERCE__`, pour que la coque Android n'en garde aucun
 * morceau (`outils/coque-sans-commerce.mjs`).
 */
import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";

import { COMMERCE } from "@/capabilities/coque";

export const Route = createFileRoute("/_authenticated/cabinet/abonnements")({
  head: () => ({
    meta: [
      { title: "Abonnements des clients — Malica Office" },
      {
        name: "description",
        content:
          "Les abonnements que la comptabilité attribue à ses clients, leur état et ses factures mensuelles.",
      },
      { property: "og:title", content: "Abonnements des clients — Malica Office" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Proposer un abonnement, c'est vendre : pas dans l'application Android
  // (`COMMERCE`). La page n'entre pas dans son paquet, et une adresse tapée
  // ramène au cabinet.
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/cabinet" });
  },
  component: __COMMERCE__
    ? lazyRouteComponent(
        () => import("@/components/malica/abonnements-du-cabinet"),
        "AbonnementsDeMonCabinet",
      )
    : () => null,
});
