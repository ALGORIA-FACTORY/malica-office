/**
 * Les pièces du dossier, chacune avec sa dernière lecture — UNE requête.
 *
 * Elle était recopiée à la main dans neuf écrans (accueil, bibliothèque,
 * capture, fiche, « À lire », règlement, coffre, dossier, rattachement), avec
 * sa clé en dur à chaque invalidation. Une copie qui change de clé cesse de
 * se rafraîchir sans que rien ne casse à la compilation. Depuis le
 * 24 octobre 2026, la requête et sa clé vivent ici, et seulement ici.
 */
import { useQueries, useQuery } from "@tanstack/react-query";

import { usePme } from "@/components/malica/pme-context";
import { office } from "@/verticals/malica-office/composition";

/** La clé de la liste : à invalider après tout ce qui change une pièce ou sa lecture. */
export const clePiecesLues = (tenantId: string) => ["pieces-lues", tenantId] as const;

/** La requête d'un dossier : la même clé et la même lecture, d'où qu'on l'appelle. */
const requetePiecesLues = (tenantId: string) => ({
  queryKey: clePiecesLues(tenantId),
  queryFn: () => office().capture.listAvecLecture(tenantId),
});

export function usePiecesLues(options: { enabled?: boolean } = {}) {
  const pme = usePme();
  return useQuery({
    ...requetePiecesLues(pme.tenantId),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}

/**
 * Les pièces de PLUSIEURS sociétés de la personne, une requête par société,
 * sous la clé de chacune : la société ouverte ne coûte rien de plus, elle est
 * déjà en cache. La base filtre (RLS) : on ne lit que là où l'on est membre.
 */
export function usePiecesLuesDesSocietes(tenantIds: readonly string[]) {
  return useQueries({ queries: tenantIds.map(requetePiecesLues) });
}
