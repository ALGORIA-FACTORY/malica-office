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
 * EN DÉVELOPPEMENT, l'API passe par le serveur web, qui la relaie (voir
 * `relais-api.ts`). On appelle donc la MÊME ORIGINE que la page — une adresse
 * relative — et la question « quel hôte ? » ne se pose plus :
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

/** Les noms qui désignent la machine où tourne le navigateur, et elle seule. */
const BOUCLE_LOCALE = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function estBoucleLocale(hote: string): boolean {
  return BOUCLE_LOCALE.has(hote.toLowerCase());
}

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
