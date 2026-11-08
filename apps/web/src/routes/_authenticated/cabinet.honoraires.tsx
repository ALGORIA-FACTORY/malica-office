/**
 * Les honoraires vivent dans la page Clients (8 novembre 2026) : le mandat de
 * chaque client dans sa fiche, les factures et la trésorerie dans la vue
 * Facturation. L'ancienne adresse y mène.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/cabinet/honoraires")({
  beforeLoad: () => {
    throw redirect({ to: "/cabinet/clients", search: { vue: "facturation" }, replace: true });
  },
});
