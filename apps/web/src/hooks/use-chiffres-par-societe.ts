/**
 * Le chiffre de chaque société, pour la liste « une société par ligne » (TVA, Charges) sous
 * « Toutes les sociétés ». Une lecture par société, chacune sous sa propre clé : le moteur du
 * Socle tourne pour chaque société avec ses données, jamais sur un ensemble (R3).
 *
 * Une société dont la lecture échoue est dite « illisible » : ni zéro, ni chiffre d'une autre.
 */
import { useQueries, useQuery } from "@tanstack/react-query";

import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import {
  chiffreCharges,
  chiffreTva,
  type ChiffreDUneSociete,
  type SocieteALire,
} from "@/lib/chiffre-par-societe";

export type ChiffreDeLaLigne = { etat: "enCours" } | { etat: "illisible" } | ChiffreDUneSociete;

export type NatureDuChiffre = "tva" | "charges";

/** La lecture du chiffre d'UNE société, sous sa clé : la ligne de « Toutes » et l'accueil la partagent. */
function lectureDuChiffre(
  nature: NatureDuChiffre,
  societe: SocieteALire,
  periode: string,
  locale: string,
  actif: boolean,
) {
  return {
    queryKey: ["chiffre-par-societe", nature, societe.id, periode, locale],
    queryFn: () =>
      nature === "tva"
        ? chiffreTva(societe, periode, locale)
        : chiffreCharges(societe, periode, locale),
    // Une lecture refusée ou en panne n'est pas à réessayer en boucle : la ligne le dit.
    enabled: actif,
    retry: false,
    staleTime: 2 * 60 * 1000,
  };
}

function ligneDe(q: { isError: boolean; data: ChiffreDUneSociete | undefined }): ChiffreDeLaLigne {
  return q.isError ? { etat: "illisible" } : (q.data ?? { etat: "enCours" });
}

export function useChiffresParSociete(
  nature: NatureDuChiffre,
  periode: string,
  actif = true,
): Map<string, ChiffreDeLaLigne> {
  const pme = usePme();
  const { locale } = useI18n();
  const lectures = useQueries({
    queries: pme.dossiers.map((d) =>
      lectureDuChiffre(
        nature,
        { id: d.id, jurisdiction: d.jurisdiction ?? "", currency: d.currency ?? "" },
        periode,
        locale,
        actif,
      ),
    ),
  });
  return new Map(pme.dossiers.map((d, i) => [d.id, ligneDe(lectures[i]!)]));
}

/**
 * Le chiffre de la société OUVERTE — l'indicateur « Vos charges » de l'accueil au bureau :
 * la même lecture, la même clé et le même moteur que sa ligne sous « Toutes les sociétés ».
 */
export function useChiffreDeLaSociete(
  nature: NatureDuChiffre,
  periode: string,
  actif = true,
): ChiffreDeLaLigne {
  const pme = usePme();
  const { locale } = useI18n();
  const societe: SocieteALire = {
    id: pme.tenantId,
    jurisdiction: pme.jurisdiction,
    currency: pme.currency,
  };
  return ligneDe(useQuery(lectureDuChiffre(nature, societe, periode, locale, actif)));
}
