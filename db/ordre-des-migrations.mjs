/**
 * Une migration ne s'applique pas en retard sur celles que la base a déjà jouées.
 *
 * ================================================================== POURQUOI
 *
 * `migrer.mjs` joue, dans l'ordre des noms, chaque fichier absent de
 * `app.migrations`. Il ne vérifiait pas qu'un fichier absent vient APRÈS le dernier
 * appliqué. Relevé le 6 novembre 2026, en fusionnant une branche de travail dans
 * `main` : la branche portait `20261127300000` (une définition de
 * `app.relecture_de_nuit`), `main` en portait une autre, `20261130230000`. Une base
 * neuve jouait la branche puis `main` ; une base déjà à jour de `main` (le staging, la
 * production) jouait la branche EN DERNIER. Même dépôt, deux fonctions différentes
 * selon l'histoire de la base — rien ne le disait, la CI testait l'une, le serveur
 * aurait reçu l'autre. C'est la règle R11, du côté du serveur.
 *
 * ================================================================== CE QUI SE FAIT
 *
 * Un fichier non appliqué dont le nom précède le dernier nom appliqué est « en
 * retard » : `migrer.mjs` refuse de le jouer, et dit lequel. On le renumérote après
 * le dernier, ce qui donne le même ordre à toutes les bases. `--en-retard` le joue
 * quand même, pour l'atelier seulement.
 */

/**
 * Les fichiers à jouer dont le nom précède le dernier déjà appliqué.
 *
 * @param {readonly string[]} fichiers les fichiers du dépôt, triés ou non
 * @param {Iterable<string>} appliquees les noms déjà inscrits dans `app.migrations`
 * @returns {string[]} les fichiers en retard, triés
 */
export function migrationsEnRetard(fichiers, appliquees) {
  const deja = new Set(appliquees);
  let derniere = "";
  for (const nom of deja) if (nom > derniere) derniere = nom;
  return fichiers.filter((nom) => !deja.has(nom) && nom < derniere).sort();
}
