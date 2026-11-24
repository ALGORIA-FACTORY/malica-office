/**
 * Les raccourcis clavier de la coque de bureau (N : ajouter une pièce, M : Malica).
 *
 * Écoutés sur la fenêtre, et seulement au poste de bureau (`useBureau`) : un téléphone ou une
 * tablette avec un clavier branché garde son comportement d'avant. La décision « cette touche
 * est-elle un raccourci ? » est dans `raccourciDuBureau`, testée à part.
 */
import { useEffect, useRef } from "react";

import { useBureau } from "@/hooks/use-bureau";
import { raccourciDuBureau, type RaccourciDuBureau } from "@/lib/coque-du-bureau";

export function useRaccourcisDuBureau(
  actions: Record<RaccourciDuBureau, () => void>,
  actifs: boolean,
) {
  const bureau = useBureau();
  // La dernière version des actions, sans réabonner l'écoute à chaque rendu.
  const courantes = useRef(actions);
  useEffect(() => {
    courantes.current = actions;
  });

  useEffect(() => {
    if (!actifs || !bureau) return;
    const surTouche = (e: KeyboardEvent) => {
      const raccourci = raccourciDuBureau(e);
      if (!raccourci) return;
      e.preventDefault();
      courantes.current[raccourci]();
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [actifs, bureau]);
}
