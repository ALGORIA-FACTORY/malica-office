/**
 * Société active de l'espace PME.
 *
 * Un utilisateur peut tenir plusieurs jeux de livres : le choix est explicite
 * et persistant, jamais « la première trouvée ». La valeur n'est qu'un
 * identifiant de tenant ; le mur de visibilité reste posé par la RLS.
 */
const KEY = "malica.pme.org";

export function readActiveOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeActiveOrgId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : la sélection reste celle de la session */
  }
}

/*
 * « Toutes les sociétés », choisi dans l'en-tête, est une VUE et non une
 * société : elle n'a pas d'identifiant à garder dans `malica.pme.org`. Elle
 * vivait dans un état local de l'écran, donc un rechargement ou un nouvel
 * onglet la perdait en silence (recette du 13 novembre 2026) : l'en-tête
 * redisait la société active, et la bibliothèque ses pièces à elle seule.
 * Gardée pour la SESSION : elle suit le rechargement, pas l'appareil.
 */
const CLE_VUE = "malica.pme.toutes";

export function readVueConsolidee(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(CLE_VUE) === "1";
  } catch {
    return false;
  }
}

export function writeVueConsolidee(ouverte: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (ouverte) window.sessionStorage.setItem(CLE_VUE, "1");
    else window.sessionStorage.removeItem(CLE_VUE);
  } catch {
    /* stockage indisponible : la vue reste celle de l'écran ouvert */
  }
}
