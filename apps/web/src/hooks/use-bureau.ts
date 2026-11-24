/**
 * Le poste de bureau : la largeur à partir de laquelle la PME se pose en colonnes.
 *
 * La même borne que les feuilles (`@media (min-width: 1024px)`) : sous elle, rien ne
 * change — le téléphone et l'application Android gardent leur dessin. Un écran qui ne
 * se dessine qu'au bureau (un tableau, la pièce à côté de sa lecture) le demande ici
 * plutôt que de rendre deux arbres et d'en cacher un.
 */
import { useSyncExternalStore } from "react";

const BUREAU = "(min-width: 1024px)";

function requete(): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia(BUREAU);
}

function sAbonner(rappel: () => void): () => void {
  const mq = requete();
  mq?.addEventListener("change", rappel);
  return () => mq?.removeEventListener("change", rappel);
}

const lire = () => requete()?.matches ?? false;
// Côté serveur, on ne sait pas : le dessin du téléphone, que le client corrige.
const lireCoteServeur = () => false;

export function useBureau(): boolean {
  return useSyncExternalStore(sAbonner, lire, lireCoteServeur);
}
