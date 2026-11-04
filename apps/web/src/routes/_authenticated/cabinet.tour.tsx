/**
 * L'ancienne adresse de la tour, dans le cabinet (19 octobre 2026). La tour
 * est devenue un espace à elle (`/tour`, 2 novembre 2026) : un lien gardé, un
 * favori, une capture d'écran d'hier y mènent encore.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/cabinet/tour")({
  beforeLoad: () => {
    throw redirect({ to: "/tour", replace: true });
  },
});
