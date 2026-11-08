/**
 * L'écran « Mise en route » est retiré (8 novembre 2026) : chacune de ses
 * étapes vivait déjà ailleurs. La carte « Mise en route » d'Aujourd'hui mène
 * aux pages où chaque geste se fait (Réglages · Équipe, Clients).
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/cabinet/mise-en-route")({
  beforeLoad: () => {
    throw redirect({ to: "/cabinet", replace: true });
  },
});
