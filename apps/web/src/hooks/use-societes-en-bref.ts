/**
 * Les sociétés de la personne en bref : ce qui attend dans chacune, et ce que cela donne en tout.
 *
 * « Mes sociétés » et l'accueil consolidé (« Toutes les sociétés », maquette du 13 novembre 2026)
 * lisent la même chose : les MÊMES lectures, sous les MÊMES clés, que la cloche (les alertes), la
 * bibliothèque (les pièces, en un appel) et les échéances. Un seul endroit les assemble, pour
 * qu'aucun des deux écrans ne redise l'autre. Aucun montant : des comptes seulement (R3).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { CIBLE_COQUE } from "@/capabilities/coque";
import { usePme } from "@/components/malica/pme-context";
import { usePiecesLuesDesSocietes } from "@/hooks/use-pieces-lues";
import { useI18n } from "@/i18n";
import { attendUnGeste, seMontreIci } from "@/lib/libelle-de-notification";
import { piecesALire } from "@/lib/lecture";
import type { Ligne } from "@/lib/mes-societes";
import { office } from "@/verticals/malica-office/composition";

export function useSocietesEnBref() {
  const { locale } = useI18n();
  const pme = usePme();
  const ids = pme.dossiers.length > 0 ? pme.dossiers.map((d) => d.id) : [pme.tenantId];

  // Les alertes : la même lecture que la cloche, sous la même clé.
  const alertes = useQuery({
    queryKey: ["notifications", "cloche", ...ids],
    queryFn: () => office().collab.notifications(ids),
    refetchInterval: 60_000,
  });
  // Les pièces : la même lecture que la bibliothèque, groupée en un appel.
  const pieces = usePiecesLuesDesSocietes(ids);
  // Les échéances : la même lecture que l'accueil et l'écran des échéances.
  const derivation = useQuery({
    queryKey: ["echeances-derivation", ...ids],
    queryFn: () => office().collab.deriverEcheances(ids),
    staleTime: 60_000,
  });
  const echeances = useQuery({
    queryKey: ["echeances", ...ids, locale],
    queryFn: () => office().collab.echeances(ids, locale),
    enabled: derivation.isFetched,
  });

  const lignes = useMemo<Ligne[]>(() => {
    const parSociete = <T>(liste: readonly T[], tenant: (x: T) => string) => {
      const m = new Map<string, number>();
      for (const x of liste) m.set(tenant(x), (m.get(tenant(x)) ?? 0) + 1);
      return m;
    };
    const aTraiter = parSociete(
      (alertes.data ?? []).filter((n) => attendUnGeste(n) && seMontreIci(n.kind, CIBLE_COQUE)),
      (n) => n.tenantId,
    );
    const enRetard = parSociete(
      (echeances.data ?? []).filter((e) => e.status === "en_retard"),
      (e) => e.tenantId,
    );
    return pme.dossiers.map((d, i) => ({
      id: d.id,
      name: d.name,
      matricule: d.matricule ?? null,
      aTraiter: aTraiter.get(d.id) ?? 0,
      aLire: piecesALire(pieces[i]?.data ?? []).length,
      enRetard: enRetard.get(d.id) ?? 0,
    }));
  }, [alertes.data, echeances.data, pieces, pme.dossiers]);

  const total = (k: "aTraiter" | "aLire" | "enRetard") => lignes.reduce((n, l) => n + l[k], 0);
  const charge = alertes.isPending || pieces.some((p) => p.isPending) || echeances.isPending;
  return { lignes, total, charge, echeances: echeances.data ?? [] };
}
