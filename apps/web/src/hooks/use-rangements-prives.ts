/**
 * Les rangements de son espace privé (planche 10) : le rayon et le nom de
 * chaque papier gardé pour soi. La base ne rend que les siens.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RangementPrive } from "@malica/socle/ports/repositories";

import { office } from "@/verticals/malica-office/composition";

const cleRangementsPrives = (tenantId: string) => ["rangements-prives", tenantId] as const;

export function useRangementsPrives(tenantId: string) {
  const qc = useQueryClient();
  const lecture = useQuery({
    queryKey: cleRangementsPrives(tenantId),
    queryFn: () => office().capture.mesRangementsPrives(tenantId),
  });
  const ranger = useMutation({
    mutationFn: async (input: { ids: readonly string[]; rayon: string; nom: string | null }) => {
      const faits: RangementPrive[] = [];
      for (const id of input.ids)
        faits.push(await office().capture.rangerPrive(id, input.rayon, input.nom));
      return faits;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cleRangementsPrives(tenantId) }),
  });
  const parPiece = new Map((lecture.data ?? []).map((r) => [r.pieceId, r]));
  return { lecture, ranger, parPiece };
}
