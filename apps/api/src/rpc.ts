/**
 * Le transport — une seule route pour tous les dépôts.
 *
 * Pourquoi pas une API REST. Le contrat existe déjà : `ports/repositories.ts`
 * définit dix dépôts et soixante-douze méthodes, typés, conçus comme la
 * frontière du domaine. Inventer une centaine d'endpoints REST par-dessus
 * dessinerait une seconde frontière, moins bonne, qu'il faudrait tenir alignée
 * sur la première à chaque évolution.
 *
 * On expose donc le contrat tel quel. Le navigateur n'a plus qu'un adaptateur
 * générique à écrire au lieu de dix, et un port ajouté demain n'exige aucune
 * route nouvelle.
 *
 * Ce que cette route ne fait pas : les téléversements de fichiers. Un flux
 * binaire n'a pas sa place dans un appel JSON — il aura son propre chemin.
 */

import type { Requete } from "./db.ts";
import { charges } from "./depots/charges.ts";
import { collab } from "./depots/collab.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";
import { referentiel } from "./depots/referentiel.ts";

/**
 * Le registre. Chaque méthode reçoit la connexion déjà placée sous l'identité
 * de l'appelant : aucune n'a à connaître l'authentification, et aucune ne peut
 * l'oublier.
 */
const DEPOTS = {
  charges,
  collab,
  identite,
  office,
  referentiel,
} as const;

export type NomDepot = keyof typeof DEPOTS;

export interface AppelRpc {
  depot: string;
  methode: string;
  args: unknown[];
}

export class RpcIntrouvable extends Error {}

/**
 * Résout un appel et l'exécute.
 *
 * La résolution passe par `Object.hasOwn` sur des objets littéraux : un appel
 * nommé `constructor` ou `__proto__` ne peut donc rien atteindre.
 */
export async function executerRpc(db: Requete, appel: AppelRpc): Promise<unknown> {
  if (!Object.hasOwn(DEPOTS, appel.depot)) {
    throw new RpcIntrouvable(`dépôt inconnu : ${appel.depot}`);
  }
  const depot = DEPOTS[appel.depot as NomDepot] as Record<string, unknown>;

  if (!Object.hasOwn(depot, appel.methode) || typeof depot[appel.methode] !== "function") {
    throw new RpcIntrouvable(`méthode inconnue : ${appel.depot}.${appel.methode}`);
  }
  const methode = depot[appel.methode] as (db: Requete, ...args: unknown[]) => Promise<unknown>;

  return methode(db, ...appel.args);
}
