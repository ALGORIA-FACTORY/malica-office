/**
 * La file hors ligne, vue par un écran — et ce qui la fait repartir.
 *
 * Les déclencheurs : le montage (on arrive sur l'espace), le retour du réseau,
 * le retour au premier plan (un téléphone verrouillé pendant l'envoi), et un
 * minuteur tant qu'il reste quelque chose — c'est lui qui couvre les délais
 * de nouvel essai. Le vidage, lui, refuse de tourner deux fois : appeler
 * souvent ne coûte rien.
 */
import { useCallback, useEffect, useState } from "react";

import type { FileDAttente } from "@/components/regalica/pme-context";
import { vidage } from "@/lib/hors-ligne";
import type { ElementDeFile } from "@/lib/hors-ligne/file";

const TOUTES_LES_MS = 60_000;

export function useFileDAttente(tenantId: string | null): FileDAttente {
  const [elements, setElements] = useState<ElementDeFile[]>([]);

  useEffect(() => {
    const v = vidage();
    let monte = true;
    const recevoir = (liste: ElementDeFile[]) => {
      // Ce qui vient de partir est publié une dernière fois : l'écran, lui,
      // ne montre que ce qui attend encore.
      if (monte) setElements(liste.filter((e) => e.etat !== "lecture_demandee"));
    };
    void v.elements().then(recevoir);
    const desabonner = v.surChangement(recevoir);
    const relancer = () => void v.vider();
    relancer();

    window.addEventListener("online", relancer);
    const surVisibilite = () => {
      if (document.visibilityState === "visible") relancer();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    const minuteur = window.setInterval(() => {
      void v.elements().then((liste) => {
        if (liste.length > 0) relancer();
      });
    }, TOUTES_LES_MS);

    return () => {
      monte = false;
      desabonner();
      window.removeEventListener("online", relancer);
      document.removeEventListener("visibilitychange", surVisibilite);
      window.clearInterval(minuteur);
    };
  }, []);

  const reessayer = useCallback((cle: string) => void vidage().reessayer(cle), []);
  const abandonner = useCallback((cle: string) => void vidage().abandonner(cle), []);

  return {
    elements: tenantId ? elements.filter((e) => e.tenantId === tenantId) : [],
    reessayer,
    abandonner,
  };
}
