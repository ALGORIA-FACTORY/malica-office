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

const CLE = "malica.jeton-long";

/**
 * Le stockage de l'application, sur l'appareil — ce que la coque garde pour
 * elle seule, et que la sauvegarde d'Android ne recopie pas (`allowBackup`
 * est faux). Le greffon vient en import différé : jamais dans un navigateur.
 */
export function coffrePreferences(): CoffreJetons {
  /*
   * Le greffon est un Proxy : toute propriété lue devient un appel natif.
   * Le rendre comme valeur d'une promesse (`.then((m) => m.Preferences)`)
   * fait lire `.then` par JavaScript — Capacitor appelait alors une méthode
   * native « then » qui n'existe pas, et l'application s'ouvrait sur un
   * écran blanc. Une fonction `async` résout son retour de la même façon.
   * On ne rend donc jamais le greffon à travers une promesse : on rend le
   * module (un espace de noms, inoffensif), et on y prend le greffon au
   * moment de s'en servir. `coffre-preferences.test.ts` tient ce piège.
   */
  const module = () => import("@capacitor/preferences");
  return {
    async lire() {
      const { value } = await (await module()).Preferences.get({ key: CLE });
      return value;
    },
    async ecrire(jeton) {
      await (await module()).Preferences.set({ key: CLE, value: jeton });
    },
    async effacer() {
      await (await module()).Preferences.remove({ key: CLE });
    },
  };
}

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
