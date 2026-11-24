/**
 * Payer la facture du mois, depuis son courriel — l'adresse du bouton « Payer la facture »
 * (20261231300000). La base prépare le paiement du reste dû de CETTE facture, puis la page de
 * choix s'ouvre (CGV, payeur, Flouci).
 *
 * Aucun titre de page figé en français (verrou d'intégrité) : la page dit le sien.
 *
 * Route fine : payer, c'est vendre ; dans l'application Android (`COMMERCE` faux), elle renvoie
 * au cabinet et le composant n'entre même pas dans le paquet.
 */
import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";

import { COMMERCE } from "@/capabilities/coque";

export const Route = createFileRoute("/_authenticated/cabinet/regler/$factureId")({
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/cabinet" });
  },
  remountDeps: ({ params }) => params,
  component: __COMMERCE__
    ? lazyRouteComponent(
        () => import("@/components/malica/payer-en-ligne"),
        "ReglerLaFactureDuCabinet",
      )
    : () => null,
});
