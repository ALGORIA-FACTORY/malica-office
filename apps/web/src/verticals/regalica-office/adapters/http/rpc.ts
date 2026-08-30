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

/**
 * L'adresse de l'API. En production elle est exigée : la deviner enverrait les
 * pièces d'un client sur un hôte que personne n'a choisi. En développement, le
 * défaut local évite d'imposer un fichier d'environnement pour lancer l'app.
 */
export function baseApi(): string {
  const declaree = import.meta.env["VITE_API_URL"] as string | undefined;
  if (declaree) return declaree.replace(/\/+$/, "");
  if (import.meta.env.PROD) {
    throw new Error("VITE_API_URL absente : l'adresse de l'API doit être déclarée");
  }
  return "http://localhost:3000";
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

async function appeler(depot: string, methode: string, args: unknown[]): Promise<unknown> {
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
