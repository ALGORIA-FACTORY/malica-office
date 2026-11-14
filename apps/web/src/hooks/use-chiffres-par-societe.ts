/**
 * Le chiffre de chaque société, pour la liste « une société par ligne » (TVA, Charges) sous
 * « Toutes les sociétés ». Une lecture par société, chacune sous sa propre clé : le moteur du
 * Socle tourne pour chaque société avec ses données, jamais sur un ensemble (R3).
 *
 * Une société dont la lecture échoue est dite « illisible » : ni zéro, ni chiffre d'une autre.
 */
import { useQueries } from "@tanstack/react-query";

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

export function useChiffresParSociete(
  nature: NatureDuChiffre,
  periode: string,
  actif = true,
): Map<string, ChiffreDeLaLigne> {
  const pme = usePme();
  const { locale } = useI18n();
  const lectures = useQueries({
    queries: pme.dossiers.map((d) => {
      const societe: SocieteALire = {
        id: d.id,
        jurisdiction: d.jurisdiction ?? "",
        currency: d.currency ?? "",
      };
      return {
        queryKey: ["chiffre-par-societe", nature, d.id, periode, locale],
        queryFn: () =>
          nature === "tva"
            ? chiffreTva(societe, periode, locale)
            : chiffreCharges(societe, periode, locale),
        // Une lecture refusée ou en panne n'est pas à réessayer en boucle : la ligne le dit.
        enabled: actif,
        retry: false,
        staleTime: 2 * 60 * 1000,
      };
    }),
  });
  return new Map(
    pme.dossiers.map((d, i) => {
      const q = lectures[i]!;
      const ligne: ChiffreDeLaLigne = q.isError
        ? { etat: "illisible" }
        : (q.data ?? { etat: "enCours" });
      return [d.id, ligne];
    }),
  );
}
