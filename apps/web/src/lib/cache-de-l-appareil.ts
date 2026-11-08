/**
 * Ce que l'écran a déjà lu, gardé sur l'appareil — l'ouverture est immédiate.
 *
 * ============================================================== POURQUOI
 *
 * 7 novembre 2026, recette d'un propriétaire de nombreuses sociétés : chaque
 * ouverture de l'application repartait de zéro et attendait le réseau avant
 * d'afficher quoi que ce soit. Les grandes applications montrent d'abord ce
 * qu'elles savaient, puis se mettent à jour sans bouger l'écran. C'est ce que
 * fait ce module, sur le web, la PWA et la coque :
 *
 *   1. à l'ouverture d'une session, les lectures gardées sont remises dans le
 *      cache des requêtes (`hydrate`) ; l'écran les affiche aussitôt ;
 *   2. elles sont plus anciennes que la fraîcheur des requêtes : chaque écran
 *      les relit donc en arrière-plan, et remplace ce qui a changé ;
 *   3. ce qui a été lu avec succès est réécrit sur l'appareil, au plus une
 *      fois toutes les deux secondes, et quand la page passe en arrière-plan.
 *
 * ============================================================== LES GARDES
 *
 *   - UNE LISTE BLANCHE de clés : des lectures en JSON simple. Ni aperçus
 *     (des adresses `blob:` mortes au rechargement), ni paiements, ni prix.
 *   - UN COMPTE, UNE ENTRÉE : la clé de stockage est l'identifiant de la
 *     personne. Une autre personne sur le même appareil ne lit jamais ce qui
 *     ne lui appartient pas.
 *   - LA DÉCONNEXION EFFACE TOUT, sur l'appareil comme en mémoire.
 *   - UNE VERSION : une mise à jour de l'application jette le cache — la
 *     forme d'une donnée peut avoir changé.
 *   - SEPT JOURS au plus : au-delà, mieux vaut attendre le réseau.
 *   - Sans IndexedDB (tests, navigation privée stricte), rien ne se passe.
 */
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** Les lectures qui se gardent : le premier élément de leur clé. */
const CLES_GARDEES: ReadonlySet<string> = new Set([
  // L'espace PME
  "pieces-lues",
  "my-organizations",
  "entities",
  "mon-forfait",
  "ref-pack",
  "dossiers",
  "types-document",
  "echeances",
  "notifications",
  "forfait-organisations",
  "forfait-sieges",
  "mon-profil",
  "mon-mandat",
  // L'espace cabinet
  "cab-clients",
  "cab-queue",
  "cab-notifications",
  "cab-echeances",
]);

const SEPT_JOURS = 7 * 24 * 60 * 60 * 1000;
const NOM = "malica-cache";

interface Entree {
  version: string;
  ecritLe: number;
  etat: DehydratedState;
}

interface SchemaDuCache extends DBSchema {
  comptes: { key: string; value: Entree };
}

let base: Promise<IDBPDatabase<SchemaDuCache>> | null = null;

function disponible(): boolean {
  return typeof indexedDB !== "undefined";
}

function ouvrir(): Promise<IDBPDatabase<SchemaDuCache>> {
  if (!base) {
    base = openDB<SchemaDuCache>(NOM, 1, {
      upgrade(db) {
        db.createObjectStore("comptes");
      },
    }).catch((raison: unknown) => {
      base = null;
      throw raison;
    });
  }
  return base;
}

/** Une lecture qui se garde : réussie, et dans la liste blanche. */
function seGarde(queryKey: readonly unknown[], statut: string): boolean {
  return statut === "success" && typeof queryKey[0] === "string" && CLES_GARDEES.has(queryKey[0]);
}

/**
 * Remet dans le cache ce que l'appareil gardait pour ce compte. Ne lève
 * jamais : un cache illisible est un cache vide. Ce qui est déjà en mémoire,
 * plus récent, n'est jamais écrasé (`hydrate` compare les dates).
 */
export async function restaurerLeCache(
  qc: QueryClient,
  compte: string,
  version: string,
  maintenant = Date.now(),
): Promise<boolean> {
  if (!disponible()) return false;
  try {
    const db = await ouvrir();
    const entree = await db.get("comptes", compte);
    if (!entree) return false;
    if (entree.version !== version || maintenant - entree.ecritLe > SEPT_JOURS) {
      await db.delete("comptes", compte);
      return false;
    }
    hydrate(qc, entree.etat);
    return true;
  } catch {
    return false;
  }
}

/**
 * Garde, au fil de l'eau, ce que ce compte a lu. Rend la fonction qui arrête
 * d'écouter ; une écriture en attente est abandonnée (la déconnexion efface
 * de toute façon).
 */
export function garderLeCache(
  qc: QueryClient,
  compte: string,
  version: string,
  delaiMs = 2000,
): () => void {
  if (!disponible()) return () => undefined;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let arrete = false;

  const ecrire = async () => {
    minuterie = null;
    try {
      const etat = dehydrate(qc, {
        shouldDehydrateQuery: (q) => seGarde(q.queryKey, q.state.status),
      });
      const db = await ouvrir();
      await db.put("comptes", { version, ecritLe: Date.now(), etat }, compte);
    } catch {
      // Un appareil plein ou une base refusée : l'écran marche sans.
    }
  };

  const plusTard = () => {
    if (arrete || minuterie) return;
    minuterie = setTimeout(() => void ecrire(), delaiMs);
  };

  const desabonner = qc.getQueryCache().subscribe((evenement) => {
    if (evenement.type !== "updated") return;
    const q = evenement.query;
    if (seGarde(q.queryKey, q.state.status)) plusTard();
  });

  const enArrierePlan = () => {
    if (page?.visibilityState === "hidden" && minuterie) {
      clearTimeout(minuterie);
      void ecrire();
    }
  };
  const page = typeof document === "undefined" ? null : document;
  page?.addEventListener("visibilitychange", enArrierePlan);

  return () => {
    arrete = true;
    desabonner();
    page?.removeEventListener("visibilitychange", enArrierePlan);
    if (minuterie) {
      clearTimeout(minuterie);
      minuterie = null;
    }
  };
}

/** La déconnexion : rien de ce compte, ni d'aucun autre, ne reste sur l'appareil. */
export async function oublierLeCache(): Promise<void> {
  if (!disponible()) return;
  try {
    const db = await ouvrir();
    await db.clear("comptes");
  } catch {
    // Rien à effacer, ou base indisponible.
  }
}
