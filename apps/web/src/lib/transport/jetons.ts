/**
 * Le coffre du jeton de rafraîchissement.
 *
 * Il ne garde qu'une chose : le jeton long, celui qui vaut trente jours et
 * qui tourne à chaque usage. Le jeton d'accès, lui, vit en mémoire dans le
 * transport et n'atteint jamais un disque — au prochain démarrage, il se
 * réobtient en un aller-retour contre le jeton long.
 *
 * Le navigateur n'a pas de coffre : sa session est un cookie httpOnly que
 * la page ne peut pas lire, et c'est mieux ainsi. Le coffre n'existe que dans
 * la coque, où le stockage appartient à l'application seule.
 *
 * Une interface, deux réalisations : la mémoire pour les épreuves et
 * l'aperçu dans Chrome, le stockage de la coque pour le téléphone. Le
 * transport ne sait pas laquelle il tient.
 */

export interface CoffreJetons {
  lire(): Promise<string | null>;
  ecrire(jetonRafraichissement: string): Promise<void>;
  effacer(): Promise<void>;
}

/** Ne survit pas au rechargement : pour les épreuves, et pour l'aperçu. */
export function coffreMemoire(initial: string | null = null): CoffreJetons {
  let garde = initial;
  return {
    async lire() {
      return garde;
    },
    async ecrire(jeton) {
      garde = jeton;
    },
    async effacer() {
      garde = null;
    },
  };
}

const CLE = "regalica.jeton-long";

/**
 * Le stockage de la page — réservé au bundle de la coque, où il appartient à
 * l'application seule. Il tient lieu de coffre tant que le stockage natif
 * n'est pas branché, et sert à vérifier dans Chrome qu'une session survit à
 * un rechargement. Dans un site web ordinaire, un jeton de trente jours à
 * portée du premier script serait une faute : ce coffre n'y est jamais monté.
 */
export function coffreDuStockageLocal(): CoffreJetons {
  return {
    async lire() {
      try {
        return window.localStorage.getItem(CLE);
      } catch {
        return null;
      }
    },
    async ecrire(jeton) {
      try {
        window.localStorage.setItem(CLE, jeton);
      } catch {
        // Stockage inaccessible : la session vaudra le temps de la page.
      }
    },
    async effacer() {
      try {
        window.localStorage.removeItem(CLE);
      } catch {
        // Rien à effacer si rien ne s'écrit.
      }
    },
  };
}
