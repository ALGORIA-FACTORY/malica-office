import { useCallback, useEffect, useState } from "react";

/**
 * Regalica est-elle ouverte ?
 *
 * Le choix se retient : un expert qui referme le panneau pour lire une balance
 * en pleine largeur ne veut pas le voir revenir à chaque navigation. Il se
 * retient par navigateur, pas en base — c'est une préférence d'écran, pas une
 * donnée du dossier.
 *
 * Elle est ouverte au départ. Un assistant qu'il faut découvrir n'assiste
 * personne ; celui qui gêne se ferme d'un clic, et se rappelle d'un autre.
 */
const CLE = "regalica.panneau.ouvert";

function auDepart(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CLE) !== "0";
  } catch {
    // Navigation privée, stockage refusé : on ouvre, sans rien casser.
    return true;
  }
}

export function usePanneauRegalica(): {
  ouvert: boolean;
  ouvrir: () => void;
  fermer: () => void;
} {
  // Le premier rendu doit être identique au serveur, sinon React réhydrate à
  // faux. On lit la préférence après le montage.
  const [ouvert, setOuvert] = useState(true);

  useEffect(() => {
    setOuvert(auDepart());
  }, []);

  const poser = useCallback((valeur: boolean) => {
    setOuvert(valeur);
    try {
      window.localStorage.setItem(CLE, valeur ? "1" : "0");
    } catch {
      // Le panneau suit quand même : seule la mémoire du choix est perdue.
    }
  }, []);

  return {
    ouvert,
    ouvrir: useCallback(() => poser(true), [poser]),
    fermer: useCallback(() => poser(false), [poser]),
  };
}
