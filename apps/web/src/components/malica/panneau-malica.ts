import { useCallback, useEffect, useState } from "react";

/**
 * Malica est-elle ouverte ?
 *
 * Le choix se retient : un expert qui referme le panneau pour lire une balance
 * en pleine largeur ne veut pas le voir revenir à chaque navigation. Il se
 * retient par navigateur, pas en base — c'est une préférence d'écran, pas une
 * donnée du dossier.
 *
 * Elle est ouverte au départ. Un assistant qu'il faut découvrir n'assiste
 * personne ; celui qui gêne se ferme d'un clic, et se rappelle d'un autre.
 *
 * Le choix est retenu PAR ESPACE. Les deux surfaces ne se ressemblent pas :
 * au cabinet, Malica est une colonne de trois cents pixels en travers d'une
 * balance ; sur le téléphone, elle est une section en bas d'une page qu'on
 * fait défiler. Refermer la première n'est pas une raison de masquer la
 * seconde — la PME et le cabinet restent séparés, jusque dans leurs
 * préférences d'écran.
 */
type Espace = "cabinet" | "pme";

const cle = (espace: Espace) => `malica.panneau.ouvert.${espace}`;

function auDepart(espace: Espace): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(cle(espace)) !== "0";
  } catch {
    // Navigation privée, stockage refusé : on ouvre, sans rien casser.
    return true;
  }
}

export function usePanneauMalica(espace: Espace): {
  ouvert: boolean;
  ouvrir: () => void;
  fermer: () => void;
} {
  // FERMÉ jusqu'à ce que la préférence soit lue. Il était ouvert au départ, le
  // temps que l'effet relise le choix : un fil refermé était posé ouvert dans
  // le DOM à chaque montage de l'écran ([true, false] au test de rendu, 17 sept.
  // 2026) — sur un téléphone lent, de quoi recouvrir l'accueil et recevoir le
  // doigt qui tape. Fermé au départ, rien ne s'ouvre qu'on n'ait voulu ouvrir ;
  // et le premier rendu reste identique au serveur, qui ne lit aucun stockage.
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    setOuvert(auDepart(espace));
  }, [espace]);

  const poser = useCallback(
    (valeur: boolean) => {
      setOuvert(valeur);
      try {
        window.localStorage.setItem(cle(espace), valeur ? "1" : "0");
      } catch {
        // Le panneau suit quand même : seule la mémoire du choix est perdue.
      }
    },
    [espace],
  );

  return {
    ouvert,
    ouvrir: useCallback(() => poser(true), [poser]),
    fermer: useCallback(() => poser(false), [poser]),
  };
}

/** La préférence telle qu'elle est mémorisée sur ce poste — vraie par défaut. */
export function panneauOuvertParDefaut(espace: Espace): boolean {
  return auDepart(espace);
}

/** Régler la préférence de ce poste ; le prochain montage la lit. */
export function definirPanneauParDefaut(espace: Espace, valeur: boolean): void {
  try {
    window.localStorage.setItem(cle(espace), valeur ? "1" : "0");
  } catch {
    // Stockage refusé : la préférence ne survit pas, rien d'autre ne casse.
  }
}
