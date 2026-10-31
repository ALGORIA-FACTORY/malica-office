import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import type { DeclarationTva } from "@malica/socle/ports/repositories";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

/** Une lecture des lignes de la déclaration : la même clé pour tous les écrans. */
const lecture = (
  packId: string | null | undefined,
  dossierId: string | null | undefined,
  jour: string,
  locale: string,
) => ({
  // La langue entre dans la clé : les libellés sont traduits. Le dossier
  // aussi : son cabinet a pu arrêter ses propres lignes (R10).
  queryKey: ["declaration-tva", packId, dossierId, jour, locale],
  queryFn: () => office().referential.declarationTva(packId!, dossierId!, jour, locale),
  enabled: Boolean(packId) && Boolean(dossierId),
  staleTime: 60 * 60 * 1000,
});

/**
 * Les lignes de la déclaration de TVA d'un dossier, en vigueur au jour dit,
 * dans la langue de l'écran, et la ligne qui reçoit chaque nature — arrêtée par
 * le dossier, son cabinet, ou le pack (`app.declaration_tva`). Le calcul de la
 * TVA (`tvaDesExtraits`) les exige : aucune ligne n'est écrite dans
 * l'application.
 */
export function useDeclarationTva(
  packId: string | null | undefined,
  dossierId: string | null | undefined,
  jour: string,
) {
  const { locale } = useI18n();
  return useQuery(lecture(packId, dossierId, jour, locale));
}

/**
 * Les mêmes lignes, une fois par jour demandé : une série de mois se calcule
 * chaque mois avec la déclaration de CE mois (revue de #145), jamais avec celle
 * du dernier. Rend `null` tant qu'une lecture manque.
 */
export function useDeclarationsTva(
  packId: string | null | undefined,
  dossierId: string | null | undefined,
  jours: readonly string[],
) {
  const { locale } = useI18n();
  const lues = useQueries({
    queries: jours.map((jour) => lecture(packId, dossierId, jour, locale)),
    combine: toutesLues,
  });
  return useMemo(
    () => (lues ? new Map(jours.map((jour, i) => [jour, lues[i]!])) : null),
    [lues, jours],
  );
}

/** Une référence stable : TanStack ne recombine que si une lecture change. */
function toutesLues(lectures: UseQueryResult<DeclarationTva>[]) {
  return lectures.every((l) => l.data) ? lectures.map((l) => l.data!) : null;
}
