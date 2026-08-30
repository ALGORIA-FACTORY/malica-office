/**
 * Société active de l'espace PME.
 *
 * Un utilisateur peut tenir plusieurs jeux de livres : le choix est explicite
 * et persistant, jamais « la première trouvée ». La valeur n'est qu'un
 * identifiant de tenant ; le mur de visibilité reste posé par la RLS.
 */
const KEY = "regalica.pme.org";

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
