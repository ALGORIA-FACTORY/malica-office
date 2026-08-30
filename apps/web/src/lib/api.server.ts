/**
 * L'API, vue depuis le serveur web.
 *
 * Les deux fonctions serveur — lire une pièce, interroger Regalica — ont besoin
 * de clés qui ne doivent jamais atteindre le navigateur. Elles tournent donc ici,
 * et doivent parler à l'API **sous l'identité de l'appelant**, pas sous une
 * identité de service.
 *
 * D'où ce module : il ne fabrique jamais d'identité, il transporte celle qui
 * arrive. Le cookie `regalica_session` de la requête entrante est réémis tel quel
 * vers l'API, qui applique la RLS comme pour n'importe quel appel du navigateur.
 * Le serveur web n'a donc aucun privilège propre — s'il est compromis, il ne peut
 * lire que ce que l'utilisateur qui l'appelle pouvait déjà lire.
 *
 * Une contrainte de déploiement en découle, et il vaut mieux la dire ici que la
 * découvrir en production : le cookie doit atteindre les deux origines. En
 * développement c'est acquis — les cookies ignorent le port, `localhost:3000` et
 * `localhost:8080` les partagent. En production, l'API doit poser le sien sur le
 * domaine parent (`COOKIE_DOMAINE=.exemple.tn`), faute de quoi ces deux fonctions
 * recevront un 401 alors que le reste de l'application marchera.
 */

/**
 * L'adresse de l'API côté serveur.
 *
 * `import.meta.env` n'existe pas dans tous les chemins serveur : on lit
 * `process.env`, que Vite alimente depuis le même fichier.
 */
export function baseApiServeur(): string {
  const declaree = process.env["VITE_API_URL"] ?? process.env["API_URL"];
  if (declaree) return declaree.replace(/\/+$/, "");
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("VITE_API_URL absente : l'adresse de l'API doit être déclarée");
  }
  return "http://localhost:3000";
}

export class ErreurApiServeur extends Error {
  constructor(
    message: string,
    readonly statut: number,
  ) {
    super(message);
    this.name = "ErreurApiServeur";
  }
}

export interface AppelApi {
  /** Un appel de dépôt, sous l'identité portée par le cookie. */
  rpc<T>(depot: string, methode: string, args?: unknown[]): Promise<T>;
  /** Les octets d'une pièce, et le type que porte la base. */
  contenu(pieceId: string): Promise<{ octets: Uint8Array; type: string }>;
}

/**
 * Fabrique un client lié à UNE requête entrante.
 *
 * Le cookie est passé à la construction, jamais lu d'un état global : deux
 * requêtes concurrentes ne peuvent pas emprunter l'identité l'une de l'autre.
 */
export function creerAppelApi(cookie: string): AppelApi {
  const base = baseApiServeur();

  return {
    async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
      const reponse = await fetch(`${base}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ depot, methode, args }),
      });
      if (!reponse.ok) {
        const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
        throw new ErreurApiServeur(
          corps?.erreur ?? `appel ${depot}.${methode} refusé`,
          reponse.status,
        );
      }
      const { resultat } = (await reponse.json()) as { resultat: T };
      return resultat;
    },

    async contenu(pieceId: string) {
      const reponse = await fetch(`${base}/pieces/${pieceId}/contenu`, { headers: { cookie } });
      if (!reponse.ok) {
        throw new ErreurApiServeur("téléchargement de la pièce impossible", reponse.status);
      }
      return {
        octets: new Uint8Array(await reponse.arrayBuffer()),
        // Le type vient de la base, porté par l'en-tête. On ne le devine pas.
        type: reponse.headers.get("content-type") ?? "application/octet-stream",
      };
    },
  };
}
