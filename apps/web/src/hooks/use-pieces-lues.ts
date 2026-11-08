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

import type { PieceLue } from "@malica/socle/ports/repositories";

import { usePme } from "@/components/malica/pme-context";
import { creerLotDAppels } from "@/lib/lot-d-appels";
import { ErreurApi } from "@/lib/transport/erreurs";
import { office } from "@/verticals/malica-office/composition";

/** La clé de la liste : à invalider après tout ce qui change une pièce ou sa lecture. */
export const clePiecesLues = (tenantId: string) => ["pieces-lues", tenantId] as const;

/**
 * Les dossiers demandés dans le même instant partent en UN appel
 * (`listAvecLectureDesSocietes`, 7 novembre 2026) ; un seul dossier garde son
 * appel d'avant. Si l'API servie ne connaît pas encore l'appel groupé (une
 * page à jour devant un serveur pas encore déployé), chaque dossier repart
 * seul : plus lent, jamais cassé.
 */
const chargerPiecesLues = creerLotDAppels<PieceLue[]>({
  une: (tenantId) => office().capture.listAvecLecture(tenantId),
  plusieurs: async (tenantIds) => {
    try {
      const lots = await office().capture.listAvecLectureDesSocietes(tenantIds);
      return new Map(lots.map((l) => [l.tenantId, l.pieces]));
    } catch (raison) {
      if (!(raison instanceof ErreurApi) || raison.statut !== 404) throw raison;
      const seuls = await Promise.all(tenantIds.map((id) => office().capture.listAvecLecture(id)));
      return new Map(tenantIds.map((id, i) => [id, seuls[i]!]));
    }
  },
  taille: 200,
  absente: [],
});

/** La requête d'un dossier : la même clé et la même lecture, d'où qu'on l'appelle. */
const requetePiecesLues = (tenantId: string) => ({
  queryKey: clePiecesLues(tenantId),
  queryFn: () => chargerPiecesLues(tenantId),
});

export function usePiecesLues(options: { enabled?: boolean } = {}) {
  const pme = usePme();
  return useQuery({
    ...requetePiecesLues(pme.tenantId),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}

/**
 * Les pièces de PLUSIEURS sociétés de la personne, sous la clé de chacune —
 * et en UN appel au réseau : les requêtes nées ensemble sont groupées par
 * `chargerPiecesLues`. La société ouverte ne coûte rien de plus, elle est
 * déjà en cache. La base filtre (RLS) : on ne lit que là où l'on est membre.
 */
export function usePiecesLuesDesSocietes(tenantIds: readonly string[]) {
  return useQueries({ queries: tenantIds.map(requetePiecesLues) });
}
