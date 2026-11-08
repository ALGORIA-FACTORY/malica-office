/**
 * L'offre et le cabinet de chaque société de la personne, en un appel
 * (`facturation.fichesDesSocietes`), sous la clé des Réglages : la
 * bibliothèque et les Réglages partagent la même lecture.
 */
import { useQuery } from "@tanstack/react-query";

import { usePme } from "@/components/malica/pme-context";
import { office } from "@/verticals/malica-office/composition";

export function useFichesDesSocietes() {
  const pme = usePme();
  const ids = pme.dossiers.length > 0 ? pme.dossiers.map((d) => d.id) : [pme.tenantId];
  const fiches = useQuery({
    queryKey: ["mon-forfait", "fiches-des-societes", ...ids],
    queryFn: () => office().facturation.fichesDesSocietes(ids),
    staleTime: 5 * 60 * 1000,
  });
  return { ids, fiches };
}
