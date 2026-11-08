/**
 * Les abonnements des clients vivent dans la page Clients (8 novembre 2026) :
 * la colonne Abonnement, l'onglet Abonnement de chaque fiche, les actions en
 * lot ; la facture Malica, dans la vue Facturation. L'ancienne adresse y mène,
 * pour que les liens et les notifications déjà envoyés ne cassent pas.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/cabinet/abonnements")({
  beforeLoad: () => {
    throw redirect({ to: "/cabinet/clients", search: { vue: "facturation" }, replace: true });
  },
});
