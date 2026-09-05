/**
 * Le dossier courant du cabinet — le client qu'on est en train de visiter.
 *
 * ============================================================== POURQUOI
 *
 * Dans le design, le rail porte une entrée « Dossier courant » qui prend le
 * nom du dernier client ouvert, et le bandeau de dossier propose d'en
 * changer. Ce n'est pas un état de route : il survit à la navigation entre
 * les écrans du cabinet, et au rechargement. Il vit donc dans le stockage
 * du navigateur, et les composants s'y abonnent — un seul endroit, une
 * seule vérité, pas de contexte à faire descendre partout.
 *
 * Ce n'est qu'une commodité de navigation : rien de comptable n'en dépend.
 */
import { useSyncExternalStore } from "react";

export interface DossierCourant {
  id: string;
  name: string;
}

const CLE = "cabinet.dossier.courant";
const abonnes = new Set<() => void>();
let cache: DossierCourant | null | undefined;

function lire(): DossierCourant | null {
  if (cache !== undefined) return cache;
  try {
    const brut = window.localStorage.getItem(CLE);
    cache = brut ? (JSON.parse(brut) as DossierCourant) : null;
  } catch {
    cache = null;
  }
  return cache;
}

function prevenir(): void {
  abonnes.forEach((f) => f());
}

/** Note le client visité. Un nom vide n'est pas un dossier : on ignore. */
export function ecrireDossierCourant(dossier: DossierCourant | null): void {
  if (dossier && !dossier.name.trim()) return;
  cache = dossier;
  try {
    if (dossier) window.localStorage.setItem(CLE, JSON.stringify(dossier));
    else window.localStorage.removeItem(CLE);
  } catch {
    // Stockage inaccessible — navigation privée. La séance suffit.
  }
  prevenir();
}

function souscrire(f: () => void): () => void {
  abonnes.add(f);
  const surStockage = (e: StorageEvent) => {
    if (e.key === CLE) {
      cache = undefined;
      f();
    }
  };
  window.addEventListener("storage", surStockage);
  return () => {
    abonnes.delete(f);
    window.removeEventListener("storage", surStockage);
  };
}

/** Le dossier courant, réactif. `null` côté serveur et tant que rien n'a été visité. */
export function useDossierCourant(): DossierCourant | null {
  return useSyncExternalStore(souscrire, lire, () => null);
}
