/**
 * Le réseau, vu de React.
 *
 * ================================================= CE QUE CE HOOK N'EST PLUS
 *
 * Il lisait `navigator.onLine` lui-même, et c'était faux sur un téléphone :
 * dans une WebView Android, cette valeur ne bascule pas en mode avion, et les
 * événements `offline` ne sont pas délivrés. Le bandeau « Hors ligne — vos
 * photos partiront au retour du réseau » ne paraissait donc jamais dans la
 * coque, ce que trois parcours Maestro signalaient depuis le 16 septembre
 * 2026.
 *
 * Pire : la file d'attente faisait la même lecture, de son côté. Deux
 * consommateurs, deux lectures de la même chose, qui ont fini par diverger.
 *
 * La vérité vit désormais dans `capabilities/reseau` — une seule source, qui
 * interroge le pont de la coque quand il y en a un. Ce hook n'en est qu'une
 * vue React.
 */
import { useSyncExternalStore } from "react";

import { estEnLigne, surChangementDuReseau } from "@/capabilities/reseau";

/** `useSyncExternalStore` veut un abonnement sans argument. */
const sAbonner = (rappel: () => void) => surChangementDuReseau(() => rappel());

// Côté serveur, on ne sait pas : on suppose le réseau, et le client corrige.
const lireCoteServeur = () => true;

export function useReseau(): { enLigne: boolean } {
  return { enLigne: useSyncExternalStore(sAbonner, estEnLigne, lireCoteServeur) };
}
