import { useCallback, useEffect, useState } from "react";

import { coque } from "@/capabilities/coque";

/**
 * Paper ou Ink — l'apparence, et qui la décide.
 *
 * =========================================================== TROIS ÉTATS
 *
 * Pas deux. « Suivre le système » est le troisième, et c'est le défaut : un
 * téléphone qui bascule en sombre le soir doit emmener l'application avec lui
 * sans qu'on ait rien à régler. Ne proposer que clair et sombre force un
 * choix que la plupart des gens ne veulent pas faire.
 *
 * ==================================================== POURQUOI PAS EN BASE
 *
 * C'est une préférence d'ÉCRAN, pas du dossier. Elle appartient à l'appareil
 * qu'on tient en main — un dirigeant peut vouloir le sombre sur son téléphone
 * et le clair sur l'ordinateur du bureau. La stocker côté serveur lui
 * imposerait le même thème partout, ce qui serait un service qu'il n'a pas
 * demandé.
 */
export type Apparence = "systeme" | "paper" | "ink";

const CLE = "regalica.apparence";

function lue(): Apparence {
  if (typeof window === "undefined") return "systeme";
  try {
    const v = window.localStorage.getItem(CLE);
    return v === "paper" || v === "ink" ? v : "systeme";
  } catch {
    // Navigation privée, stockage refusé : on suit le système.
    return "systeme";
  }
}

/** Pose ou retire la classe que la feuille de style attend. */
function appliquer(a: Apparence) {
  if (typeof document === "undefined") return;
  const sombre =
    a === "ink" || (a === "systeme" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", sombre);
  // La barre d'état du téléphone suit : icônes claires sur Ink, sombres sur Paper.
  coque().apparence.appliquer(sombre);
}

export function useApparence(): {
  apparence: Apparence;
  choisir: (a: Apparence) => void;
} {
  // Le premier rendu doit être identique au serveur : on lit après le montage.
  const [apparence, setApparence] = useState<Apparence>("systeme");

  useEffect(() => {
    const a = lue();
    setApparence(a);
    appliquer(a);
  }, []);

  // Tant qu'on suit le système, on suit ses changements — y compris quand ils
  // arrivent pendant que l'écran est ouvert.
  useEffect(() => {
    if (apparence !== "systeme" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const suivre = () => appliquer("systeme");
    mq.addEventListener("change", suivre);
    return () => mq.removeEventListener("change", suivre);
  }, [apparence]);

  const choisir = useCallback((a: Apparence) => {
    setApparence(a);
    appliquer(a);
    try {
      window.localStorage.setItem(CLE, a);
    } catch {
      // L'écran suit quand même : seule la mémoire du choix est perdue.
    }
  }, []);

  return { apparence, choisir };
}
