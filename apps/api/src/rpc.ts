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
import { acces } from "./depots/acces.ts";
import { banque } from "./depots/banque.ts";
import { capture } from "./depots/capture.ts";
import { charges } from "./depots/charges.ts";
import { collab } from "./depots/collab.ts";
import { conseil } from "./depots/conseil.ts";
import { conversations } from "./depots/conversations.ts";
import { corpus } from "./depots/corpus.ts";
import { honoraires } from "./depots/honoraires.ts";
import { exports } from "./depots/exports.ts";
import { fabrique } from "./depots/fabrique.ts";
import { facturation } from "./depots/facturation.ts";
import { identite } from "./depots/identite.ts";
import { journal } from "./depots/journal.ts";
import { immo } from "./depots/immo.ts";
import { integrations } from "./depots/integrations.ts";
import { office } from "./depots/office.ts";
import { parametrage } from "./depots/parametrage.ts";
import { referentiel } from "./depots/referentiel.ts";
import { signalements } from "./depots/signalements.ts";
import { stocks } from "./depots/stocks.ts";
import { supervision } from "./depots/supervision.ts";
import { tiers } from "./depots/tiers.ts";
import { tour } from "./depots/tour.ts";

/**
 * Le registre. Chaque méthode reçoit la connexion déjà placée sous l'identité
 * de l'appelant : aucune n'a à connaître l'authentification, et aucune ne peut
 * l'oublier.
 */
const DEPOTS = {
  acces,
  banque,
  capture,
  charges,
  collab,
  conseil,
  conversations,
  corpus,
  honoraires,
  exports,
  fabrique,
  facturation,
  identite,
  immo,
  integrations,
  journal,
  office,
  parametrage,
  referentiel,
  signalements,
  stocks,
  supervision,
  tiers,
  tour,
} as const;

type NomDepot = keyof typeof DEPOTS;

/**
 * Le contrat tel qu'il est servi : chaque dépôt et ses méthodes, triés.
 * `contrat/rpc.json` en est la copie figée ; `contrat.test.ts` échoue si
 * l'un bouge sans l'autre, et le test web vérifie que chaque port de
 * l'application existe ici.
 */
export function contratRpc(): Record<string, string[]> {
  const contrat: Record<string, string[]> = {};
  for (const nom of Object.keys(DEPOTS).sort()) {
    const depot = DEPOTS[nom as NomDepot] as Record<string, unknown>;
    contrat[nom] = Object.keys(depot)
      .filter((m) => typeof depot[m] === "function")
      .sort();
  }
  return contrat;
}

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
