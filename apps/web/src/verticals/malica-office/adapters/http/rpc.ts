/**
 * L'adaptateur navigateur — un seul, pour les dix dépôts.
 *
 * Les ports sont le contrat de l'API : chaque méthode d'un dépôt devient un
 * appel `{depot, methode, args}` sur la route unique `/rpc`. Il n'y a donc rien
 * à écrire par dépôt, et un port ajouté demain est servi sans une ligne de plus.
 *
 * Ce que cet adaptateur ne fait pas : porter un fichier, ni faire parler un
 * modèle. Les octets ont leur chemin (`capture.ts`), Malica le sien
 * (`malica.ts`). Et la politique de l'appel — session, jeton, réseau,
 * version — n'est pas ici non plus : elle est dans `lib/transport`, partagée.
 */
import type { SuiviDeTrace } from "@malica/socle/ports/repositories";

import { entetesDuSuivi, suiviDesArguments } from "@/lib/parcours/traces";
import { transport } from "@/lib/transport";

/**
 * Un appel nomme une pièce dont l'appareil connaît la trace : il la porte
 * (`x-malica-trace`), et l'API rattache ses étapes à la capture. Le suivi
 * explicite d'un pas de la file y ajoute sa clé (`x-malica-cle`).
 */
export async function appeler(
  depot: string,
  methode: string,
  args: unknown[],
  suivi?: SuiviDeTrace | null,
): Promise<unknown> {
  const { resultat } = await transport().json<{ resultat: unknown }>("/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...entetesDuSuivi(suivi ?? suiviDesArguments(args)),
    },
    body: JSON.stringify({ depot, methode, args }),
  });
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
