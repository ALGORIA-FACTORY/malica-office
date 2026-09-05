/**
 * L'adaptateur navigateur — un seul, pour les dix dépôts.
 *
 * Les ports sont le contrat de l'API : chaque méthode d'un dépôt devient un
 * appel `{depot, methode, args}` sur la route unique `/rpc`. Il n'y a donc rien
 * à écrire par dépôt, et un port ajouté demain est servi sans une ligne de plus.
 *
 * Ce que cet adaptateur ne fait pas : porter un fichier. Un flux binaire n'a pas
 * sa place dans un appel JSON — le téléversement aura son propre chemin.
 */

/** Les noms qui désignent la machine où tourne le navigateur, et elle seule. */
const BOUCLE_LOCALE = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function estBoucleLocale(hote: string): boolean {
  return BOUCLE_LOCALE.has(hote.toLowerCase());
}

/**
 * Où joindre l'API, vu du navigateur.
 *
 * ============================================ LE PROBLÈME QUE ÇA RÉSOUT
 *
 * `VITE_API_URL=http://localhost:3000` est juste sur le poste de développement
 * et FAUX partout ailleurs : ouverte depuis un téléphone, l'application
 * demanderait à ce téléphone de se servir lui-même l'API. L'écran s'affiche, la
 * connexion échoue, et rien ne dit pourquoi.
 *
 * ================================================================ LA RÈGLE
 *
 * EN DÉVELOPPEMENT, l'API passe par le serveur web, qui la relaie (voir le
 * `proxy` de `vite.config.ts`). On appelle donc la MÊME ORIGINE que la page —
 * une adresse relative — et la question « quel hôte ? » ne se pose plus :
 *
 *   — un seul port à ouvrir au pare-feu ;
 *   — un seul certificat à accepter sur le téléphone ;
 *   — plus aucun CORS, puisqu'il n'y a plus rien à croiser.
 *
 * L'exception est délibérée : une adresse déclarée qui ne désigne PAS la boucle
 * locale est un vrai serveur d'API, choisi exprès. On l'emploie telle quelle.
 *
 * ============================================================ EN PRODUCTION
 *
 * L'adresse reste EXIGÉE. La deviner enverrait les pièces d'un client sur un
 * hôte que personne n'a choisi — et une page servie depuis un domaine compromis
 * désignerait alors elle-même sa destination.
 */
export function resoudreApi(declaree: string | undefined, production: boolean): string {
  const propre = declaree?.replace(/\/+$/, "");

  if (production) {
    if (!propre) {
      throw new Error("VITE_API_URL absente : l'adresse de l'API doit être déclarée");
    }
    return propre;
  }

  // En développement, une adresse distante déclarée est une décision : on la
  // respecte. Tout le reste passe par le relais du serveur web.
  if (propre) {
    try {
      if (!estBoucleLocale(new URL(propre).hostname)) return propre;
    } catch {
      // Une adresse relative déclarée est déjà ce qu'on veut : la même origine.
      return propre;
    }
  }
  return "";
}

export function baseApi(): string {
  return resoudreApi(import.meta.env["VITE_API_URL"] as string | undefined, import.meta.env.PROD);
}

export class ErreurApi extends Error {
  constructor(
    message: string,
    readonly statut: number,
  ) {
    super(message);
    this.name = "ErreurApi";
  }
}

export async function appeler(depot: string, methode: string, args: unknown[]): Promise<unknown> {
  const reponse = await fetch(`${baseApi()}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // La session voyage par cookie httpOnly : jamais de jeton lisible par un
    // script de la page.
    credentials: "include",
    body: JSON.stringify({ depot, methode, args }),
  });

  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
    throw new ErreurApi(corps?.erreur ?? `appel ${depot}.${methode} refusé`, reponse.status);
  }

  const { resultat } = (await reponse.json()) as { resultat: unknown };
  return resultat;
}

/**
 * Fabrique un dépôt dont chaque méthode appelle l'API.
 *
 * Le mandataire répond à n'importe quel nom de méthode : c'est ce qui évite
 * d'écrire dix adaptateurs. Deux garde-fous, cependant — sans eux, un `await`
 * sur l'objet lui-même le prendrait pour une promesse et partirait en appel
 * réseau nommé « then ».
 */
export function creerDepotHttp<T extends object>(depot: string): T {
  return new Proxy({} as T, {
    get(_cible, propriete) {
      if (typeof propriete !== "string") return undefined;
      // `then` : sans cette garde, `await depot` déclencherait un appel.
      // `toJSON` : idem au moment de sérialiser.
      if (propriete === "then" || propriete === "toJSON") return undefined;
      return (...args: unknown[]) => appeler(depot, propriete, args);
    },
  });
}
