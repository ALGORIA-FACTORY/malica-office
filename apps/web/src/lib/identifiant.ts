/**
 * Un identifiant de la base (UUID), reconnu AVANT d'aller la questionner.
 *
 * 1er novembre 2026 : une adresse tronquée (`/pme/piece/829e3c34`) lançait
 * cinq lectures que la base refusait toutes (« valeur non admise »), et
 * remplissait « Ce qui n'a pas marché » de pannes qui n'en étaient pas. Ce
 * qui ne ressemble pas à un identifiant n'est pas demandé : l'écran dit
 * « introuvable », et rien ne part.
 */
const UN_IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function estUnIdentifiant(valeur: string): boolean {
  return UN_IDENTIFIANT.test(valeur);
}
