/**
 * Le transport — la politique commune à tout appel vers l'API.
 *
 * ============================================================== POURQUOI
 *
 * Trois adaptateurs faisaient chacun leur `fetch` : les dépôts, la session,
 * la capture. Trois endroits où poser un en-tête, trois où traiter un 401,
 * trois où l'oublier. Le téléphone en ajoutait un quatrième besoin — le jeton
 * porteur, le rafraîchissement, le 426 — et ce n'est pas un besoin qu'on
 * écrit trois fois. Il n'y a plus qu'un appel, et les adaptateurs le
 * partagent.
 *
 * ================================================================ LA RÈGLE
 *
 *   1. `X-Regalica-Client` sur chaque requête : qui parle, en quelle version.
 *   2. Natif : `Authorization: Bearer` et pas de cookie. Web : le cookie, et
 *      rien d'autre — la page ne voit jamais un jeton.
 *   3. `fetch` rejette → ErreurReseau. Hors ligne si le navigateur le dit,
 *      injoignable sinon. Rien n'est arrivé jusqu'à l'API.
 *   4. 426 → l'écran « mettez à jour », et ErreurVersion. Rien à réessayer.
 *   5. 401 en natif, hors des routes d'authentification → rafraîchir, en vol
 *      unique, puis rejouer UNE fois la même requête. Un second 401, ou un
 *      rafraîchissement refusé, c'est la fin de la session : le coffre est
 *      vidé, l'écran renvoyé à la connexion.
 *   6. Sinon, la réponse — refus compris. Ce qu'on en fait appartient à
 *      l'adaptateur.
 *
 * Le corps d'une requête rejouée doit être rejouable : une chaîne ou un Blob,
 * jamais un flux.
 */
import { ErreurApi, ErreurReseau, ErreurVersion } from "./erreurs";
import type { CoffreJetons } from "./jetons";
import { creerRafraichisseur, type Compte } from "./rafraichir";

export interface Transport {
  /** Un appel, avec la politique. Rend la réponse telle quelle, refus compris. */
  appeler(chemin: string, init?: RequestInit): Promise<Response>;
  /** Le corps JSON d'un appel réussi ; lève ErreurApi sinon, avec le message de l'API. */
  json<T>(chemin: string, init?: RequestInit): Promise<T>;
  /** Natif : garder ce que la connexion a rendu — le jeton d'accès en mémoire, le long au coffre. */
  retenirLaSession(jetonAcces: string, jetonRafraichissement: string | undefined): Promise<void>;
  /** Natif, au démarrage : un jeton d'accès neuf contre le jeton long du coffre. */
  reprendreLaSession(): Promise<Compte | null>;
  /** Vrai si un jeton d'accès est porté — c'est-à-dire si le natif a une session. */
  porteUnJeton(): boolean;
  /** Natif : le jeton long, pour le révoquer à la déconnexion. */
  jetonLong(): Promise<string | null>;
  /** Natif : plus de jeton, ni en mémoire ni au coffre. */
  oublierLaSession(): Promise<void>;
}

export interface DependancesTransport {
  base: string;
  natif: boolean;
  coffre: CoffreJetons;
  versionClient: string;
  fetch?: typeof fetch;
  enLigne?: () => boolean;
  surDeconnexion: () => void;
  surMiseAJourRequise: (versionMinimale: string | null) => void;
}

/** Les routes qui ne se rafraîchissent pas : un 401 y est une réponse, pas une session perdue. */
function estUneRouteDAuthentification(chemin: string): boolean {
  return chemin === "/auth" || chemin.startsWith("/auth/");
}

export function creerTransport(deps: DependancesTransport): Transport {
  const appelerReseau = deps.fetch ?? ((entree, init) => fetch(entree, init));
  const enLigne =
    deps.enLigne ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const rafraichisseur = creerRafraichisseur({
    base: deps.base,
    coffre: deps.coffre,
    fetch: appelerReseau,
    versionClient: deps.versionClient,
  });
  let jetonAcces: string | null = null;

  async function oublier(): Promise<void> {
    jetonAcces = null;
    await deps.coffre.effacer();
  }

  async function envoyer(chemin: string, init: RequestInit): Promise<Response> {
    const entetes = new Headers(init.headers ?? {});
    entetes.set("X-Regalica-Client", deps.versionClient);
    if (deps.natif && jetonAcces) entetes.set("Authorization", `Bearer ${jetonAcces}`);
    try {
      return await appelerReseau(`${deps.base}${chemin}`, {
        ...init,
        headers: entetes,
        credentials: deps.natif ? "omit" : "include",
      });
    } catch {
      throw new ErreurReseau(enLigne() ? "injoignable" : "hors_ligne");
    }
  }

  async function appeler(chemin: string, init: RequestInit = {}): Promise<Response> {
    let reponse = await envoyer(chemin, init);

    if (reponse.status === 426) {
      const corps = (await reponse.json().catch(() => null)) as { versionMinimale?: string } | null;
      const minimale = corps?.versionMinimale ?? null;
      deps.surMiseAJourRequise(minimale);
      throw new ErreurVersion(minimale);
    }

    if (reponse.status === 401 && deps.natif && !estUneRouteDAuthentification(chemin)) {
      const tourne = await rafraichisseur.rafraichirUneFois();
      if (!tourne) {
        await oublier();
        deps.surDeconnexion();
        return reponse;
      }
      jetonAcces = tourne.jeton;
      reponse = await envoyer(chemin, init);
      if (reponse.status === 401) {
        await oublier();
        deps.surDeconnexion();
      }
    }

    return reponse;
  }

  return {
    appeler,

    async json<T>(chemin: string, init: RequestInit = {}): Promise<T> {
      const reponse = await appeler(chemin, init);
      if (!reponse.ok) {
        const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
        throw new ErreurApi(corps?.erreur ?? `${chemin} : ${reponse.status}`, reponse.status);
      }
      return (await reponse.json()) as T;
    },

    async retenirLaSession(acces, long) {
      if (!deps.natif) return;
      jetonAcces = acces;
      if (long) await deps.coffre.ecrire(long);
    },

    async reprendreLaSession() {
      if (!deps.natif) return null;
      const tourne = await rafraichisseur.rafraichirUneFois();
      if (!tourne) return null;
      jetonAcces = tourne.jeton;
      return tourne.utilisateur;
    },

    porteUnJeton() {
      return jetonAcces !== null;
    },

    jetonLong() {
      return deps.coffre.lire();
    },

    oublierLaSession: oublier,
  };
}
