/**
 * L'URL d'administration de la base, pour les outils qui posent ce qu'aucune
 * route ne pose (un opérateur de plateforme, une adresse d'essai prouvée).
 *
 * Même ordre de résolution que `db/migrer.mjs` et `db/registre.mjs` : l'option
 * `--base`, puis l'environnement, puis `apps/api/.env`. Le fichier se lit depuis
 * la racine du dépôt et non le dossier courant. L'URL n'est jamais affichée.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

function duFichier() {
  try {
    const env = readFileSync(join(RACINE, "apps", "api", ".env"), "utf8");
    return /^DATABASE_URL_ADMIN=(.*)$/m.exec(env)?.[1]?.trim().replace(/^"|"$/g, "");
  } catch {
    return undefined;
  }
}

/** L'URL d'administration, ou `undefined` si aucune source ne la donne. */
export function urlDAdministration(base) {
  return base || process.env["DATABASE_URL_ADMIN"]?.trim() || duFichier();
}
