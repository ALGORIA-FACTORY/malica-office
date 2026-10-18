/**
 * Déclarer une superposition — au bouton retour, à `Échap`, et au focus.
 *
 *   useSuperposition(montrerPiece, () => setPiece(false));
 *   useSuperposition(malica.ouvert, malica.fermer, panneau);  // + le focus
 *
 * Ouverte, elle est sur la pile ; fermée — par son propre bouton, par le
 * retour d'Android ou par `Échap` —, elle n'y est plus. Rien à faire de plus
 * dans l'écran.
 *
 * ====================================================== ET LE FOCUS CLAVIER
 *
 * Mesuré à 1280 px, fil de Malica ouvert : le panneau comptait 4 éléments
 * focalisables, et **20 restaient atteignables derrière lui**. On tabulait
 * dans une page qu'on ne voyait plus, et à la fermeture le focus était perdu
 * sur `BODY`. Sur une tablette avec clavier, c'est la seule façon de se
 * déplacer.
 *
 * Deux choses, donc, et la première ne coûte rien à l'appelant :
 *
 * 1. **Le focus revient d'où il est parti.** L'élément actif au moment de
 *    l'ouverture est mémorisé, et il le retrouve à la fermeture. Aucun écran
 *    n'a à s'en occuper.
 *
 * 2. **Le focus reste dedans**, si l'écran passe la référence de son panneau.
 *    Il y entre à l'ouverture, et `Tab` y boucle au lieu d'en sortir. Sans
 *    référence, le point 1 s'applique seul — c'est une dégradation, pas une
 *    panne.
 */
import { useEffect, useRef, type RefObject } from "react";

import { ouvrirSuperposition } from "@/lib/superpositions";

/** Ce qui peut recevoir le focus, dans l'ordre du document. */
const FOCALISABLES = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function dedans(panneau: HTMLElement): HTMLElement[] {
  return [...panneau.querySelectorAll<HTMLElement>(FOCALISABLES)].filter(
    // Un élément masqué par CSS reste dans le DOM et sort du parcours :
    // `offsetParent` est la façon la moins chère de le savoir.
    (e) => e.offsetParent !== null || e === document.activeElement,
  );
}

/**
 * Le focus, et lui seul : il entre dans le panneau, `Tab` y boucle, et il
 * revient a son declencheur a la fermeture.
 *
 * Expose a part parce qu'une superposition n'est pas toujours sur la pile :
 * « Qu'est-ce que c'est ? » se ferme en REPONDANT, jamais en reculant — y
 * brancher le retour ou `Echap` enverrait les pieces sans type, et c'est une
 * decision de produit, pas d'adaptation. Elle a donc besoin du focus sans la
 * pile. Une seule implementation, deux portes d'entree.
 */
export function usePiegeDeFocus(ouverte: boolean, panneau: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!ouverte) return undefined;

    const declencheur = document.activeElement;
    const element = panneau.current;

    if (element) {
      // Le premier élément du panneau — en pratique son bouton de fermeture,
      // qui est le premier dans l'arbre de chacun de ces écrans.
      const premier = dedans(element)[0];
      if (premier) premier.focus();
      else {
        element.tabIndex = -1;
        element.focus();
      }
    }

    const surTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !element) return;
      const liste = dedans(element);
      if (liste.length === 0) return;
      const premier = liste[0];
      const dernier = liste[liste.length - 1];
      const actif = document.activeElement;
      if (!element.contains(actif)) {
        // On est déjà sorti — par un clic derrière, ou parce que le panneau
        // s'est reconstruit. On rentre, du bon côté.
        e.preventDefault();
        (e.shiftKey ? dernier : premier)?.focus();
        return;
      }
      if (e.shiftKey && actif === premier) {
        e.preventDefault();
        dernier?.focus();
      } else if (!e.shiftKey && actif === dernier) {
        e.preventDefault();
        premier?.focus();
      }
    };

    window.addEventListener("keydown", surTab);
    return () => {
      window.removeEventListener("keydown", surTab);
      // Rendre le focus : l'élément peut avoir disparu avec la fermeture.
      if (declencheur instanceof HTMLElement && declencheur.isConnected) declencheur.focus();
    };
  }, [ouverte, panneau]);
}

export function useSuperposition(
  ouverte: boolean,
  fermer: () => void,
  panneau?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!ouverte) return undefined;
    return ouvrirSuperposition(fermer);
  }, [ouverte, fermer]);

  // Sans reference, le retour du focus s'applique seul : c'est une
  // degradation, pas une panne.
  const vide = useRef<HTMLElement | null>(null);
  usePiegeDeFocus(ouverte, panneau ?? vide);
}
