/**
 * Le réseau, tel que le navigateur le voit.
 *
 * `navigator.onLine` dit « pas de réseau » avec certitude, et « du réseau »
 * avec optimisme — un Wi-Fi sans internet passe pour en ligne. C'est assez
 * pour un bandeau : on ne promet rien de plus que ce que l'appareil sait.
 */
import { useSyncExternalStore } from "react";

function sAbonner(rappel: () => void): () => void {
  window.addEventListener("online", rappel);
  window.addEventListener("offline", rappel);
  return () => {
    window.removeEventListener("online", rappel);
    window.removeEventListener("offline", rappel);
  };
}

const lire = () => navigator.onLine;
// Côté serveur, on ne sait pas : on suppose le réseau, et le client corrige.
const lireCoteServeur = () => true;

export function useReseau(): { enLigne: boolean } {
  return { enLigne: useSyncExternalStore(sAbonner, lire, lireCoteServeur) };
}
