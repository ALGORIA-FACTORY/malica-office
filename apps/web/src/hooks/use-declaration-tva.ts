import { useQuery } from "@tanstack/react-query";
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

/** La série se lit en un appel : douze mois, c'était douze requêtes. */
const serie = (
  packId: string | null | undefined,
  dossierId: string | null | undefined,
  jours: readonly string[],
  locale: string,
) => ({
  // Commence par la clé de la lecture simple : arrêter la déclaration invalide les deux.
  queryKey: ["declaration-tva", "serie", packId, dossierId, jours, locale],
  queryFn: () => office().referential.declarationsTva(packId!, dossierId!, [...jours], locale),
  enabled: Boolean(packId) && Boolean(dossierId) && jours.length > 0,
  staleTime: 60 * 60 * 1000,
});

/**
 * Les mêmes lignes, une fois par jour demandé : une série de mois se calcule
 * chaque mois avec la déclaration de CE mois (revue de #145), jamais avec celle
 * du dernier. Rend `null` tant que la lecture manque.
 */
export function useDeclarationsTva(
  packId: string | null | undefined,
  dossierId: string | null | undefined,
  jours: readonly string[],
) {
  const { locale } = useI18n();
  const { data } = useQuery(serie(packId, dossierId, jours, locale));
  return useMemo(
    () => (data ? new Map(jours.map((jour, i) => [jour, data[i]!])) : null),
    [data, jours],
  );
}

/**
 * Vrai si la lecture a échoué après ses reprises : l'accueil sort alors de son
 * attente neutre au lieu d'attendre une donnée qui ne viendra pas (revue de
 * #222). Même clé que `useDeclarationsTva` : aucune requête de plus.
 */
export function useDeclarationsTvaEnEchec(
  packId: string | null | undefined,
  dossierId: string | null | undefined,
  jours: readonly string[],
): boolean {
  const { locale } = useI18n();
  return useQuery(serie(packId, dossierId, jours, locale)).isError;
}
