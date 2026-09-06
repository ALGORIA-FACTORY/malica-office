/**
 * Les lectures en cours — pour qu'une lecture survive au téléphone.
 *
 * ============================================================== POURQUOI
 *
 * Une lecture dure des minutes : l'œil (Qwen) puis le désignateur (DeepSeek,
 * en mode raisonnement). Pendant ce temps, un téléphone se verrouille, une
 * page se recharge, un réseau flanche. La requête HTTP meurt ; la lecture,
 * elle, continue côté serveur et aboutit — on l'a vu : la pièce était
 * « lue » en base, et l'écran disait « Une erreur est survenue ».
 *
 * Pire : la personne réessaie, et une SECONDE lecture part pour la même
 * pièce — un appel de modèle payé deux fois, et la base refuse la seconde
 * persistance (R7 : une pièce ne se lit qu'une fois).
 *
 * Ce registre dit ce qui est en cours et permet de le REJOINDRE :
 *
 *   - `lireOuRejoindre`  lance la lecture, ou rend celle qui tourne déjà ;
 *   - `etat`             dit si une lecture est en cours pour une pièce ;
 *
 * et l'écran, lui, redemande l'état de la pièce quand la connexion revient,
 * au lieu d'annoncer une panne.
 *
 * ============================================================ SES LIMITES
 *
 * Le registre vit dans la mémoire du processus qui sert l'application. Il
 * couvre un serveur ; deux instances ne se verraient pas. C'est le cas de
 * l'atelier et du premier service ; le jour où il y en a deux, ce module
 * devient une table — son contrat ne change pas.
 */

interface LectureEnCours {
  /** Instant du départ, en millisecondes. */
  depuis: number;
}

export interface Registre<T> {
  lireOuRejoindre(pieceId: string, lancer: () => Promise<T>): Promise<T>;
  etat(pieceId: string): LectureEnCours | null;
  /** Ce que le registre a en mémoire — pour les épreuves. */
  enCours(): number;
}

/**
 * Un registre. `maintenant` est injectable pour que les épreuves ne
 * dépendent pas de l'horloge.
 */
export function creerRegistre<T>(maintenant: () => number = () => Date.now()): Registre<T> {
  const lectures = new Map<string, { promesse: Promise<T>; depuis: number }>();
  return {
    lireOuRejoindre(pieceId, lancer) {
      const deja = lectures.get(pieceId);
      if (deja) return deja.promesse;
      const promesse = lancer().finally(() => {
        lectures.delete(pieceId);
      });
      lectures.set(pieceId, { promesse, depuis: maintenant() });
      // Une lecture qui échoue est retirée du registre — la personne pourra
      // réessayer — mais sa raison reste celle de l'appelant, pas la nôtre.
      promesse.catch(() => undefined);
      return promesse;
    },
    etat(pieceId) {
      const l = lectures.get(pieceId);
      return l ? { depuis: l.depuis } : null;
    },
    enCours() {
      return lectures.size;
    },
  };
}

/**
 * Le registre du processus : un seul, partagé par toutes les requêtes.
 *
 * Ancré sur `globalThis`, et non sur ce module : en développement, le
 * serveur Vite instancie ce module une fois PAR fonction serveur qui
 * l'importe — `readPiece` et `etatLecture` ne voyaient pas le même registre,
 * et l'écran apprenait qu'aucune lecture ne tournait alors qu'elle tournait.
 * Le processus, lui, est unique : c'est là que le registre doit vivre.
 */
const CLE = Symbol.for("regalica.lectures-en-cours");

export function registre<T>(): Registre<T> {
  const global = globalThis as unknown as Record<symbol, Registre<unknown> | undefined>;
  global[CLE] ??= creerRegistre<unknown>();
  return global[CLE] as Registre<T>;
}
