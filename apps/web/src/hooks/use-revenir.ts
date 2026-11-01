/**
 * Le bouton retour (‹) de la PME : revenir LÀ D'OÙ L'ON VIENT.
 *
 * 1er novembre 2026, Wissem : le retour d'un dossier ouvert depuis la
 * bibliothèque ramenait à l'accueil. Chaque écran écrivait sa destination en
 * dur. Désormais le retour suit l'historique — la bibliothèque si l'on venait
 * d'elle, l'accueil si l'on venait de lui —, et ne prend la destination de
 * l'écran (son « repli ») que lorsqu'il n'y a rien derrière : un lien ouvert
 * directement, une notification, une application relancée. Le bouton retour
 * d'Android suit la même règle (`__root.tsx`).
 */
import { useRouter } from "@tanstack/react-router";

/** Où revenir quand l'historique est vide : l'écran parent. */
export type Repli = "/pme" | "/pme/list" | "/pme/reglages";

export function useRevenir() {
  const router = useRouter();
  return (repli: Repli) => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: repli, replace: true });
  };
}
