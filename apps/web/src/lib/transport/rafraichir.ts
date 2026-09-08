/**
 * Rafraîchir la session, en vol unique.
 *
 * Quand le jeton d'accès expire, dix requêtes peuvent recevoir 401 dans la
 * même seconde — la liste, l'accueil, l'état d'une lecture. Chacune voudrait
 * rafraîchir. Or le jeton long TOURNE : le premier rafraîchissement révoque
 * l'ancien, et le second, parti avec le même ancien, serait refusé — et
 * déconnecterait la personne sans raison. Une seule promesse partagée : les
 * autres l'attendent.
 */
import type { CoffreJetons } from "./jetons";

export interface Compte {
  id: string;
  email: string;
}

interface Rafraichissement {
  jeton: string;
  utilisateur: Compte;
}

export interface Rafraichisseur {
  /** Un jeton d'accès neuf contre le jeton long du coffre, ou `null` si la session est finie. */
  rafraichirUneFois(): Promise<Rafraichissement | null>;
}

export function creerRafraichisseur(deps: {
  base: string;
  coffre: CoffreJetons;
  fetch: typeof fetch;
  versionClient: string;
}): Rafraichisseur {
  let enVol: Promise<Rafraichissement | null> | null = null;

  async function rafraichir(): Promise<Rafraichissement | null> {
    const ancien = await deps.coffre.lire();
    if (!ancien) return null;
    let reponse: Response;
    try {
      reponse = await deps.fetch(`${deps.base}/auth/rafraichir`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Malica-Client": deps.versionClient },
        credentials: "omit",
        body: JSON.stringify({ jetonRafraichissement: ancien }),
      });
    } catch {
      // Réseau absent : la session n'est pas finie, elle est juste injoignable.
      // On ne touche pas au coffre — au retour du réseau, on réessaiera.
      return null;
    }
    if (!reponse.ok) return null;
    const corps = (await reponse.json()) as {
      jeton: string;
      jetonRafraichissement: string;
      utilisateur: Compte;
    };
    await deps.coffre.ecrire(corps.jetonRafraichissement);
    return { jeton: corps.jeton, utilisateur: corps.utilisateur };
  }

  return {
    rafraichirUneFois() {
      if (!enVol) {
        enVol = rafraichir().finally(() => {
          enVol = null;
        });
      }
      return enVol;
    },
  };
}
