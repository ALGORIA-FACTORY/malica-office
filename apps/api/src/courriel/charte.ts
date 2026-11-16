/**
 * La charte des courriels — une fois, pour tous.
 *
 * Reprise des maquettes du 13 novembre 2026 (« E-mails et notifications push »,
 * page Système), elles-mêmes tirées des jetons de l'appli (`styles-pme.css`) :
 * le repère rG, l'accent Evergreen, les cartes arrondies, les chiffres en
 * IBM Plex Mono, un thème clair et un thème sombre.
 *
 * Couleurs FONCTIONNELLES uniquement : le fond, la carte et les gris pour le
 * texte et les filets ; une couleur de signal pour dire ce qui s'est passé —
 * fait (vert), attend une réponse (ambre), refusé ou en retard (vermillon),
 * information (azur). Aucune couleur décorative.
 *
 * Le clair est écrit en ligne : c'est lui qu'affiche une messagerie qui ne
 * connaît pas `prefers-color-scheme` (Outlook). Le sombre vient de la feuille.
 */

export interface Palette {
  fond: string;
  carte: string;
  bloc: string;
  piste: string;
  texte: string;
  texte2: string;
  texte3: string;
  filet: string;
  accent: string;
  surAccent: string;
  fait: string;
  faitFond: string;
  attend: string;
  attendFond: string;
  retard: string;
  retardFond: string;
  info: string;
  infoFond: string;
}

export const CLAIR: Palette = {
  fond: "#EFF1F0",
  carte: "#FFFFFF",
  bloc: "#F5F5F5",
  piste: "#E3E6E5",
  texte: "#0A0A0A",
  texte2: "#3C4450",
  texte3: "#5F6673",
  filet: "#DCDFDE",
  accent: "#235340",
  surAccent: "#FFFFFF",
  fait: "#235340",
  faitFond: "#DCEFE3",
  attend: "#8A5B00",
  attendFond: "#F6EAC8",
  retard: "#B23A1C",
  retardFond: "#F8DED6",
  info: "#1F6FB2",
  infoFond: "#D6E7F6",
};

export const SOMBRE: Palette = {
  fond: "#0A0A0A",
  carte: "#141414",
  bloc: "#1E1E1E",
  piste: "#2A2A2A",
  texte: "#FFFFFF",
  texte2: "#A7A7AD",
  texte3: "#8E8E97",
  filet: "#262626",
  accent: "#8FE3B1",
  surAccent: "#07210F",
  fait: "#8FE3B1",
  faitFond: "#1B3326",
  attend: "#DFC078",
  attendFond: "#33290F",
  retard: "#F08D72",
  retardFond: "#3A1C14",
  info: "#8CBCE8",
  infoFond: "#132638",
};

export const POLICE =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Les chiffres, les références et les étiquettes. */
export const POLICE_MONO =
  "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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
