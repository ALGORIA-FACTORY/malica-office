/**
 * L'écran « Mise en route » est retiré (8 novembre 2026) : chacune de ses
 * étapes vivait déjà ailleurs. La carte « Mise en route » d'Aujourd'hui mène
 * aux pages où chaque geste se fait (Réglages · Équipe, Clients).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/cabinet/mise-en-route")({
  // Une redirection rendue, pas levée : au chargement direct de l'adresse,
  // une redirection levée pendant le rendu serveur laissait une erreur vide.
  component: () => <Navigate to="/cabinet" replace />,
});
