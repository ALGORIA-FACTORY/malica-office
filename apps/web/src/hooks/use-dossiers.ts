/**
 * Les sept dossiers et le rangement des types — chargés une fois, partagés
 * par la capture, l'accueil, la page Dossier, la bibliothèque et la fiche.
 *
 * La clé des types est celle que les écrans emploient déjà
 * (`types-document`) : une seule requête en cache, pas deux.
 */
import { useQuery } from "@tanstack/react-query";

import { useI18n } from "@/i18n";
import type { Dossier } from "@/lib/dossiers";
import { office } from "@/verticals/malica-office/composition";

const UNE_HEURE = 60 * 60 * 1000;

export function useDossiers() {
  const { locale } = useI18n();
  const dossiers = useQuery({
    queryKey: ["dossiers", locale],
    queryFn: () => office().referential.dossiers(locale),
    staleTime: UNE_HEURE,
  });
  const types = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: UNE_HEURE,
  });
  const liste: readonly Dossier[] = dossiers.data ?? [];
  return {
    dossiers: liste,
    types: types.data ?? [],
    pret: dossiers.isSuccess && types.isSuccess,
    parCode: (code: string | null | undefined) => liste.find((d) => d.code === code) ?? null,
  };
}
