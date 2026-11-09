import { createFileRoute, redirect } from "@tanstack/react-router";

import { CIBLE_COQUE } from "@/capabilities/coque";

// Pas de vitrine : l'adresse racine ouvre directement la connexion. Une seule
// porte — on se connecte, puis on choisit son espace. L'application Android est
// l'espace PME et rien d'autre : sa coque s'ouvre directement sur le dossier.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: CIBLE_COQUE ? "/pme" : "/auth" });
  },
});
