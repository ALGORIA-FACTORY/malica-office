/**
 * L'interrupteur « Notes d'honoraires » de la tour, lu par l'écran.
 *
 * La note d'honoraires est éteinte jusqu'à une version postérieure à la mise
 * en production (décision du dirigeant, 12 novembre 2026). L'écran ne décide
 * rien : il lit la base (`plateforme.fonction_ouverte`), comme le serveur, et
 * tant qu'il n'a pas lu « oui » il ne montre ni facture ni trésorerie
 * d'honoraires. Le mandat et son forfait ne passent pas par ici.
 */
import { useQuery } from "@tanstack/react-query";

import { office } from "@/verticals/malica-office/composition";

/** La clé de la lecture : la tour l'invalide quand elle règle l'interrupteur. */
export const CLE_DES_NOTES_D_HONORAIRES = ["fonction-ouverte", "notes_honoraires"] as const;

export function useNotesDHonoraires(): { ouvertes: boolean; chargement: boolean } {
  const lecture = useQuery({
    queryKey: CLE_DES_NOTES_D_HONORAIRES,
    queryFn: () => office().honoraires.notesOuvertes(),
  });
  return { ouvertes: lecture.data === true, chargement: lecture.isPending };
}
