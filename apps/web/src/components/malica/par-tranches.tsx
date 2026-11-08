/**
 * Une liste dessinée par tranches, là où un crochet ne peut pas vivre (dans
 * un `.map`) : voir `hooks/use-par-tranches`.
 */
import type { ReactNode } from "react";

import { useParTranches } from "@/hooks/use-par-tranches";

export function ParTranches<T>({
  elements,
  rendre,
  taille = 60,
}: {
  elements: readonly T[];
  rendre: (element: T) => ReactNode;
  taille?: number;
}) {
  const { visibles, reste, sentinelle } = useParTranches(elements, taille);
  return (
    <>
      {visibles.map(rendre)}
      {reste ? <span ref={sentinelle} aria-hidden /> : null}
    </>
  );
}
