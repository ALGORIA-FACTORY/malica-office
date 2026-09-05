/**
 * Le relais de l'API, pour le serveur de développement.
 *
 * ============================================================== POURQUOI
 *
 * Sans lui, le navigateur appelle deux origines : la page sur 8080 et l'API sur
 * 3000. Il faut alors ouvrir deux ports au pare-feu, accepter deux certificats
 * sur le téléphone, et tenir une liste d'origines autorisées côté API — trois
 * occasions de se tromper là où il n'en faut aucune.
 *
 * Relayées, page et API partagent une seule origine. Le CORS ne s'applique plus
 * du tout : il n'y a plus rien à croiser. Et le certificat de développement,
 * accepté une fois, vaut pour l'ensemble.
 *
 * ==================================================== POURQUOI PAS `server.proxy`
 *
 * Le `proxy` de Vite ne s'applique pas ici : le greffon nitro sert la requête
 * avant lui, et l'appel repart avec la page 404 de l'application — un 404 qui
 * ressemble à une route manquante alors que le relais n'a simplement jamais eu
 * la main. Mesuré : `/rpc`, `/moi` et `/auth/session` rendaient tous du HTML.
 *
 * On s'insère donc dans `server.middlewares` avec `enforce: "pre"`, ce qui
 * place le relais AVANT toute la chaîne de rendu.
 *
 * ============================================================= EN PRODUCTION
 *
 * Ce greffon n'existe pas : `apply: "serve"` le réserve au serveur de
 * développement. En production, l'API est servie par son propre hôte, déclaré.
 */
import { request as requeteHttp } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Les chemins que l'API sert, et eux seuls.
 *
 * ====================================================== LA COLLISION SUR /auth
 *
 * `/auth` est une page de l'APPLICATION — l'écran de connexion. `/auth/session`,
 * `/auth/connexion` et les autres sont des routes de l'API. Le préfixe seul ne
 * suffit donc pas : relayer `/auth` tout court envoyait la page de connexion à
 * l'API, qui répondait « Cannot GET /auth ». L'application devenait
 * inaccessible depuis le téléphone, sans que rien n'explique pourquoi.
 *
 * On déclare donc pour chaque entrée si le chemin EXACT lui appartient, ou si
 * seuls ses sous-chemins comptent.
 *
 * Vérifié contre les deux listes de routes : `/auth` est la seule collision.
 * `/rpc`, `/moi`, `/pieces` et `/sante` n'ont pas d'équivalent dans
 * l'application.
 */
const CHEMINS: ReadonlyArray<{ base: string; exact: boolean }> = [
  { base: "/rpc", exact: true },
  { base: "/moi", exact: true },
  { base: "/sante", exact: true },
  { base: "/pieces", exact: true },
  // Le journal d'atelier : ce que l'appareil de l'utilisateur a vraiment vu.
  { base: "/journal-atelier", exact: true },
  // Seuls les sous-chemins : /auth est l'écran de connexion.
  { base: "/auth", exact: false },
];

export function estPourLApi(url: string): boolean {
  const chemin = url.split("?")[0] ?? "";
  return CHEMINS.some(
    ({ base, exact }) => (exact && chemin === base) || chemin.startsWith(`${base}/`),
  );
}

/**
 * Les en-têtes qui ne franchissent pas un relais.
 *
 * Ils décrivent la connexion elle-même, pas le message : les retransmettre
 * ferait décrire à l'API un tuyau qui n'est pas le sien.
 */
const SAUTE_A_SAUT = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // Réécrit vers l'amont : l'API doit se voir elle-même comme destinataire.
  "host",
]);

/**
 * Un jeu d'en-têtes nettoyé, dans un sens comme dans l'autre.
 *
 * ================================================ LE DÉFAUT QUE ÇA CORRIGE
 *
 * Le relais fait dialoguer deux protocoles : le navigateur parle HTTP/2 —
 * c'est ce que fait un téléphone dès qu'il voit du HTTPS — et l'API parle
 * HTTP/1.1. Chacun refuse ce que l'autre emploie, et il faut nettoyer LES DEUX
 * SENS :
 *
 *   à l'aller  — HTTP/2 envoie des en-têtes de contrôle qui commencent par
 *                deux-points : `:method`, `:path`, `:authority`. Node les
 *                refuse dans une requête HTTP/1.1 : « Header name must be a
 *                valid HTTP token [":method"] », et toute l'application tombe.
 *
 *   au retour  — HTTP/1.1 répond avec `connection: keep-alive`. HTTP/2 les
 *                interdit : « HTTP/1 Connection specific headers are
 *                forbidden », et le serveur s'arrête net.
 *
 * J'ai corrigé l'aller et livré sans vérifier le retour : le serveur ne
 * démarrait plus du tout. Les deux sens sont maintenant éprouvés, et par la
 * même fonction — il n'y a plus d'endroit où l'oubli soit possible.
 *
 * Mes essais en curl n'avaient rien vu : ils parlaient HTTP/1.1, où le
 * problème n'existe pas. C'est le genre de défaut qu'un vrai appareil trouve
 * en trois secondes et qu'une ligne de commande ne trouve jamais.
 */
export function sansEntetesDeConnexion(
  entetes: Record<string, string | number | string[] | undefined>,
): Record<string, string | number | string[]> {
  const propres: Record<string, string | number | string[]> = {};
  for (const [nom, valeur] of Object.entries(entetes)) {
    if (valeur === undefined) continue;
    // Les pseudo-en-têtes de HTTP/2 n'ont pas d'équivalent en HTTP/1.1.
    if (nom.startsWith(":")) continue;
    if (SAUTE_A_SAUT.has(nom.toLowerCase())) continue;
    propres[nom] = valeur;
  }
  return propres;
}

/** À l'aller : nettoyé, et l'hôte réécrit vers l'API. */
export function entetesRelayees(
  entrantes: Record<string, string | string[] | undefined>,
  hote: string,
): Record<string, string | number | string[]> {
  return { ...sansEntetesDeConnexion(entrantes), host: hote };
}

export function relaisApi(cible = "http://localhost:3000"): Plugin {
  const { hostname, port } = new URL(cible);

  return {
    name: "regalica:relais-api",
    apply: "serve",
    enforce: "pre",
    configureServer(serveur) {
      serveur.middlewares.use((req: IncomingMessage, res: ServerResponse, suite) => {
        if (!req.url || !estPourLApi(req.url)) {
          suite();
          return;
        }

        const amont = requeteHttp(
          {
            hostname,
            port: port || 80,
            path: req.url,
            method: req.method ?? "GET",
            // Le cookie de session passe — c'est lui qui porte l'identité. Les
            // pseudo-en-têtes de HTTP/2 et ceux qui décrivent la connexion, non.
            headers: entetesRelayees(req.headers, `${hostname}:${port}`),
          },
          (reponse) => {
            // Au retour aussi : HTTP/2 refuse le `keep-alive` que HTTP/1.1
            // renvoie, et le serveur s'arrêterait net.
            res.writeHead(reponse.statusCode ?? 502, sansEntetesDeConnexion(reponse.headers));
            reponse.pipe(res);
          },
        );

        amont.on("error", (erreur) => {
          // L'API arrêtée est le cas le plus fréquent, et le plus mal diagnostiqué.
          // On le dit en clair plutôt que de laisser tomber la connexion.
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              erreur: `API injoignable sur ${cible} — est-elle démarrée ? (${erreur.message})`,
            }),
          );
        });

        req.pipe(amont);
      });
    },
  };
}
