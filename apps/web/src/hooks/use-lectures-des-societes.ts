/**
 * Les lectures restantes de chaque société — la plus basse, nommée, sous « Toutes les sociétés »
 * (maquette approuvée le 13 novembre 2026). Chaque société a sa licence : on ne les additionne pas.
 * Même lecture, même clé que `pme.tsx` (`mon-forfait`) : celle de la société ouverte est déjà là.
 */
import { useQueries } from "@tanstack/react-query";

import { usePme } from "@/components/malica/pme-context";
import { laPlusBasse } from "@/lib/toutes-les-societes";
import { office } from "@/verticals/malica-office/composition";

export function useLaPlusBasseDesLectures(actif: boolean) {
  const pme = usePme();
  const forfaits = useQueries({
    queries: pme.dossiers.map((d) => ({
      queryKey: ["mon-forfait", d.id],
      queryFn: () => office().facturation.monForfait(d.id),
      enabled: actif,
      retry: false,
      staleTime: 5 * 60 * 1000,
    })),
  });
  // Désactivée, une requête garde ses données en cache : hors « Toutes », on ne les lit pas.
  if (!actif) return null;
  return laPlusBasse(
    pme.dossiers.map((d, i) => ({
      id: d.id,
      name: d.name,
      restantes: forfaits[i]?.data?.lectures_restantes ?? null,
      droit: forfaits[i]?.data?.lectures_droit ?? null,
    })),
  );
}
