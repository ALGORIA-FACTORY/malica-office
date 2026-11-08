/**
 * Une longue liste se dessine par tranches — l'écran s'ouvre aussitôt, quel
 * que soit le nombre de pièces (planche 1, approuvée le 7 novembre 2026).
 *
 * Un propriétaire de cent cinquante sociétés ouvre un mois : trois mille
 * lignes, trois mille nœuds dessinés avant le premier affichage. Ici, la
 * première tranche s'affiche, et la suivante vient quand la sentinelle, posée
 * sous la dernière ligne, approche de l'écran — avant qu'on y arrive.
 *
 * La liste elle-même ne change pas : ce sont les mêmes lignes, dans le même
 * ordre. Une nouvelle liste (un autre groupe ouvert) repart de la première
 * tranche.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function useParTranches<T>(elements: readonly T[], taille = 60, cle: unknown = null) {
  const [combien, setCombien] = useState(taille);
  const precedente = useRef(cle);
  if (precedente.current !== cle) {
    precedente.current = cle;
    if (combien !== taille) setCombien(taille);
  }
  const reste = elements.length > combien;
  const observateur = useRef<IntersectionObserver | null>(null);

  const sentinelle = useCallback(
    (el: HTMLElement | null) => {
      observateur.current?.disconnect();
      observateur.current = null;
      if (!el || !reste) return;
      if (typeof IntersectionObserver === "undefined") {
        setCombien((n) => n + taille);
        return;
      }
      const obs = new IntersectionObserver(
        (entrees) => {
          if (entrees.some((e) => e.isIntersecting)) setCombien((n) => n + taille);
        },
        { rootMargin: "800px" },
      );
      obs.observe(el);
      observateur.current = obs;
    },
    [reste, taille],
  );

  useEffect(() => () => observateur.current?.disconnect(), []);

  return { visibles: elements.slice(0, combien), reste, sentinelle };
}
