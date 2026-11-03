/**
 * Le signaleur de l'application — un seul, monté au premier appel, branché
 * sur `journal.etapes`. Le retour du réseau le vide : ce qui attendait part.
 */
import { office } from "@/verticals/malica-office/composition";

import { creerSignaleur, plateforme, type Signaleur } from "./signaleur";

let instance: Signaleur | null = null;

export function signaleur(): Signaleur {
  if (!instance) {
    const s = creerSignaleur({
      envoyer: (lot) => office().journal.etapes(lot),
      plateforme,
      nouvelleTrace: () => crypto.randomUUID(),
    });
    globalThis.addEventListener?.("online", () => void s.vider());
    instance = s;
  }
  return instance;
}
