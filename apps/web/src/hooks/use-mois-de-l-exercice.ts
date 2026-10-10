/**
 * Les mois que les écrans de la PME proposent — une seule règle.
 *
 * ================================================================= POURQUOI
 *
 * 10 octobre 2026. Trois écrans proposaient de choisir un mois, et chacun
 * portait sa propre constante : douze mois glissants pour la TVA, six pour les
 * charges, quatre pour les documents. Le dirigeant qui cherchait mars le
 * trouvait sur un écran et pas sur les deux autres, et aucune des trois
 * fenêtres ne correspondait à un objet du métier — un dossier se boucle par
 * exercice.
 *
 * Décision du commanditaire : tous les mois de l'exercice paraissent, dès
 * janvier. Ce hook est le seul endroit où cela s'écrit.
 *
 * La clôture vient de la FICHE du dossier, jamais d'ici (R4) : un exercice
 * tunisien clôt au 31 décembre, un autre ailleurs ne clôt pas là, et une fiche
 * sans clôture renseignée est permise (R10) — l'année civile sert alors de
 * défaut, et `debutDExercice` le dit déjà.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { usePme } from "@/components/malica/pme-context";
import { office } from "@/verticals/malica-office/composition";
import { moisDeLExercice, type MoisDExercice } from "@malica/socle/exercice";

import { currentPeriod } from "./use-tva";

export type { MoisDExercice };

/**
 * Les douze mois de l'exercice qui contient `periode`, du plus ancien au plus
 * récent, chacun sachant s'il a déjà eu lieu.
 */
export function useMoisDeLExercice(periode: string): MoisDExercice[] {
  const pme = usePme();
  const fiche = useQuery({
    queryKey: ["fiche", pme.tenantId],
    queryFn: () => office().identity.ficheCourante(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });
  const cloture = fiche.data?.clotureExercice ?? null;

  return useMemo(() => moisDeLExercice(cloture, periode, currentPeriod()), [cloture, periode]);
}
