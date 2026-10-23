/**
 * La charte des courriels — une fois, pour tous.
 *
 * L'invitation, le mot de passe oublié et les relances portaient chacun leur
 * copie de la palette et de l'échappement. Une couleur changée dans l'un
 * restait l'ancienne dans les autres. Elles vivent ici.
 *
 * L'identité est celle de l'application : l'encre et le papier, le souci en
 * accent, Inter quand la messagerie la connaît.
 */

export const ENCRE = "#0A0A0A";
export const PAPIER = "#FAFAFA";
export const SOUCI = "#C8901F";
export const SOUCI_SUR_ENCRE = "#E3B75C";
export const GRIS = "#6E6E73";
export const FILET = "#E5E5EA";
export const POLICE =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Tout texte venu d'un utilisateur ou de la base, avant d'entrer dans du HTML. */
export function echapper(texte: string): string {
  return texte
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
