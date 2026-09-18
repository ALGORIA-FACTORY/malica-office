/**
 * La garde de la base de test — chargée avant tout test (`--import`).
 *
 * Un test qui écrit dans la base de travail est un bug, pas une commodité.
 * Jusqu'au 11 septembre 2026, `npm test` lisait `apps/api/.env` et écrivait
 * donc dans `malica_local` : 1 075 comptes d'essai y dormaient. Les tests ont
 * désormais leur base, `malica_test`, montée par `npm run base-de-test`, et
 * cette garde les arrête net s'ils visent encore la base de travail — y compris
 * par l'URL d'administration, dont ils se servent pour archiver ce qu'ils ont
 * créé.
 *
 * Elle ne décide rien d'autre : la CI travaille sur une base jetable nommée
 * `malica`, et une exécution sans base du tout saute d'elle-même ses tests de
 * base.
 */

const BASE_DE_TRAVAIL = "malica_local";

/** Le nom de la base que désigne une URL PostgreSQL. */
function nomDeLaBase(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function refuserLaBaseDeTravail(env: Record<string, string | undefined>): void {
  for (const cle of ["DATABASE_URL", "DATABASE_URL_ADMIN"]) {
    const url = env[cle];
    if (!url || nomDeLaBase(url) !== BASE_DE_TRAVAIL) continue;
    throw new Error(
      `${cle} désigne ${BASE_DE_TRAVAIL}, la base de travail : les tests n'y écrivent pas. ` +
        "Montez la base de test avec « npm run base-de-test » (elle écrit apps/api/.env.test), puis relancez.",
    );
  }
}

/**
 * Aucun test n'envoie de vrai courriel. La clé Brevo vit dans `apps/api/.env`,
 * que les tests lisent aussi : sans cette coupure, une invitation d'essai
 * partirait vers une adresse @essai.local — et coûterait un envoi réel.
 */
export function couperLeCourriel(env: Record<string, string | undefined>): void {
  delete env["BREVO_API_KEY"];
}

refuserLaBaseDeTravail(process.env);
couperLeCourriel(process.env);
