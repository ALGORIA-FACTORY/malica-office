/**
 * La charte des courriels — une fois, pour tous.
 *
 * L'invitation, le mot de passe oublié et les notifications portent chacun leur
 * copie de la palette et de l'échappement. Une couleur changée dans l'un
 * restait l'ancienne dans les autres. Elles vivent ici.
 *
 * Couleurs FONCTIONNELLES uniquement (charte de marque) : l'encre, le papier et
 * les gris pour le texte et les filets ; une couleur d'état pour dire ce qui
 * s'est passé — succès, erreur, alerte, en cours. Aucune couleur décorative.
 *
 * Contraste : le texte gris est AAA (7:1 ou plus) sur le blanc et sur le
 * papier ; les couleurs d'état ne portent jamais un texte seules, elles
 * colorent une barre dont le titre dit déjà l'état.
 */

// --- Clair ------------------------------------------------------------------
export const ENCRE = "#0A0A0A";
export const PAPIER = "#FAFAFA";
export const CARTE = "#FFFFFF";
export const GRIS = "#555555";
export const FILET = "#E5E5EA";

// --- Sombre (prefers-color-scheme: dark) ------------------------------------
export const FOND_SOMBRE = "#0A0A0A";
export const CARTE_SOMBRE = "#161616";
export const TEXTE_SOMBRE = "#FAFAFA";
export const GRIS_SOMBRE = "#B8B8BD";
export const FILET_SOMBRE = "#2C2C30";

// --- Couleurs d'état --------------------------------------------------------
export const EVERGREEN = "#3A8F54"; // succès
export const VERMILION = "#BF4424"; // erreur
export const AMBRE = "#B58614"; // alerte
export const AZURE = "#2968A5"; // en cours

export const POLICE =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Les caractères arabes : une police qui les porte dans tous les clients. */
export const POLICE_ARABE =
  "'Noto Naskh Arabic', 'Segoe UI', Tahoma, 'Geeza Pro', Arial, sans-serif";

/** Tout texte venu d'un utilisateur ou de la base, avant d'entrer dans du HTML. */
export function echapper(texte: string): string {
  return texte
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
