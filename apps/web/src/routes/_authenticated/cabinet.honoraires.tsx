/**
 * Les honoraires vivent dans la page Clients (8 novembre 2026) : le mandat de
 * chaque client dans sa fiche, les factures et la trésorerie dans la vue
 * Facturation. L'ancienne adresse y mène.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/cabinet/honoraires")({
  // Une redirection rendue, pas levée : au chargement direct de l'adresse,
  // une redirection levée pendant le rendu serveur laissait une erreur vide.
  component: () => <Navigate to="/cabinet/clients" search={{ vue: "facturation" }} replace />,
});
