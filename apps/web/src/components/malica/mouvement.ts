/**
 * Le mouvement entre écrans — ce que le routeur doit savoir, et rien de plus.
 *
 * ================================================================= POURQUOI
 *
 * Avant ce module, Malica Office n'avait AUCUNE transition entre écrans :
 * quinze écrans se remplaçaient d'une image à l'autre, et rien ne disait si
 * l'on avançait ou si l'on revenait. Sur un téléphone tenu à une main, dans
 * un entrepôt, c'est la différence entre « je suis entré quelque part » et
 * « l'écran a sauté ».
 *
 * ============================================================= LA TECHNIQUE
 *
 * L'API View Transitions du navigateur, pilotée par TanStack Router, et zéro
 * dépendance. Le budget de la coque est de 350 Ko de JavaScript initial
 * gzippé (`apps/web/scripts/budget-bundle.mjs`, qui fait échouer la CI
 * au-delà) : une bibliothèque de mouvement en vaudrait 15 à 40 pour un
 * résultat que le compositeur du navigateur produit seul, sans une ligne de
 * JavaScript par image. Ce fichier ne porte AUCUNE animation — elles sont
 * toutes dans `styles.css`. Il ne décide que de deux choses : quand ouvrir
 * une transition, et dans quel sens elle va.
 *
 * Là où l'API n'existe pas, le routeur appelle la mise à jour directement :
 * l'écran change sans transition, comme avant. Il n'y a pas de repli à
 * écrire, et rien à charger pour le découvrir.
 *
 * ================================================== POURQUOI PAS `router.tsx`
 *
 * `createRouter` accepte `defaultViewTransition`, et ce serait l'endroit
 * naturel — pour une application d'une seule surface. Celle-ci en a deux :
 * la PME (sombre, arrondie, tenue au pouce) et le cabinet (« Edition One »,
 * monochrome, coins nets, sur grand écran). Le mouvement appartient à la
 * première, et poser l'option à la racine l'aurait imposée à la seconde dès
 * que le navigateur ignore les TYPES de transition — car la fonction
 * `types`, qui porte le filtrage, n'est alors pas appelée du tout.
 *
 * L'option est donc installée par le layout qui PORTE la surface
 * (`routes/_authenticated/pme.tsx`), et retirée quand il se démonte. Le
 * cabinet ne peut pas en hériter, même par accident.
 *
 * ========================================== JAMAIS AU PREMIER CHARGEMENT
 *
 * Une transition de vue n'existe que si quelqu'un appelle
 * `document.startViewTransition()`, et le routeur ne l'appelle que sur une
 * navigation. Ouvrir l'application n'en est pas une. Aucune garde n'est
 * nécessaire pour cela : c'est la forme de l'API.
 */

import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Le système d'exploitation demande-t-il moins de mouvement ?
 *
 * Lu à CHAQUE appel, et non une fois au montage : le réglage se change dans
 * les paramètres du téléphone pendant que l'application est ouverte, et une
 * valeur mise en cache au démarrage aurait continué à bouger.
 *
 * Faux en l'absence de `matchMedia` — rendu serveur, moteur ancien. Rien ne
 * s'y animant, le défaut n'y change rien.
 */
function moinsDeMouvement(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // Media queries refusées — navigation privée verrouillée, moteur bridé.
    return false;
  }
}

/** La surface qui a droit au mouvement. Le cabinet n'en est pas. */
const SURFACE = "/pme";

const dansLaSurface = (chemin: string) => chemin === SURFACE || chemin.startsWith(`${SURFACE}/`);

/**
 * Installe la transition d'écran de la surface PME, le temps que son layout
 * soit monté.
 *
 * ==================================================== CE QUE REND `types`
 *
 *   false            aucune transition — et c'est le cas le plus fréquent
 *   ["pme-avant"]    on va plus loin : l'écran entre par la FIN de la ligne
 *   ["pme-arriere"]  on revient : il entre par le DÉBUT
 *
 * `styles.css` ne lit ces deux noms que pour en déduire un SIGNE : une seule
 * paire d'animations sert les deux sens, et le sens d'écriture s'y applique
 * par-dessus (`--sens`). En arabe, « avant » part donc de la gauche sans
 * qu'une règle soit dupliquée.
 *
 * ======================================================= LES QUATRE GARDES
 *
 * 1. `pathChanged` — un changement de paramètre de recherche n'est pas un
 *    changement d'écran. Sans cette garde, `?pieces=…` posé par la capture,
 *    ou le `replace` de « capturer la suivante », auraient fait glisser un
 *    écran qui reste le même.
 * 2. les deux chemins dans la surface — on ne glisse pas en entrant dans
 *    l'application ni en la quittant pour le cabinet : entrer dans un
 *    produit n'est pas avancer dedans.
 * 3. `moinsDeMouvement()` — AUCUNE transition n'est alors ouverte. Ce n'est
 *    pas une animation éteinte après coup : il n'y a rien à éteindre. C'est
 *    le premier des deux filets, le second étant dans `styles.css` pour le
 *    cas où le navigateur ignore les types et n'appelle donc jamais cette
 *    fonction.
 * 4. la direction — elle vient de l'index d'historique que le routeur range
 *    dans l'état de la navigation, et non d'une comparaison de chemins : on
 *    ne devine pas qu'un écran est « plus profond » qu'un autre à la forme
 *    de son URL. Index illisible : on suppose qu'on avance, parce que c'est
 *    ce qu'un premier geste fait neuf fois sur dix.
 */
export function useTransitionDEcran(): void {
  const router = useRouter();

  useEffect(() => {
    const precedent = router.options.defaultViewTransition;
    router.options.defaultViewTransition = {
      types: ({ fromLocation, toLocation, pathChanged }) => {
        if (!pathChanged || !fromLocation) return false;
        if (!dansLaSurface(fromLocation.pathname)) return false;
        if (!dansLaSurface(toLocation.pathname)) return false;
        if (moinsDeMouvement()) return false;

        const depuis = fromLocation.state?.__TSR_index;
        const vers = toLocation.state?.__TSR_index;
        const recule = Number.isFinite(depuis) && Number.isFinite(vers) && vers < depuis;
        return [recule ? "pme-arriere" : "pme-avant"];
      },
    };
    return () => {
      /*
       * `delete` et non `= precedent` : `exactOptionalPropertyTypes` est vrai
       * dans ce dépôt, donc une option absente n'est pas une option à
       * `undefined`. Remettre `undefined` serait un refus du compilateur — et
       * il a raison : la racine n'a JAMAIS porté cette option, et la rendre
       * telle qu'elle était veut dire la retirer.
       */
      if (precedent === undefined) delete router.options.defaultViewTransition;
      else router.options.defaultViewTransition = precedent;
    };
  }, [router]);
}
