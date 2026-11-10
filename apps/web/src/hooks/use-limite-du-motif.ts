/**
 * La longueur maximale d'un motif de réponse, lue en base.
 *
 * La base porte la limite (`app.motif_longueur_max()`) et c'est elle qui
 * tranche ; l'écran la lit pour ne pas laisser saisir plus. Aucune copie de la
 * valeur ne vit dans le code : deux valeurs finissent par diverger.
 *
 * `undefined` tant qu'elle n'est pas lue : le champ n'est alors pas borné à
 * l'écran, et la base refuse un motif trop long par `refus.piece.motif_trop_long`.
 * Mettre un nombre en attendant serait écrire la copie qu'on vient d'enlever.
 */
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

export function useLimiteDuMotif(): number | undefined {
  return useQuery({
    queryKey: ["limite-du-motif"],
    queryFn: () => office().collab.limiteDuMotif(),
    staleTime: Infinity,
  }).data;
}
