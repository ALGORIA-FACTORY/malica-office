/**
 * Monte la base de test du poste — `malica_test` — depuis les migrations seules.
 *
 *   npm run base-de-test
 *
 * ============================================================== POURQUOI
 *
 * Les tests de l'API écrivaient dans la base de travail, `malica_local` : un
 * compte et deux organisations à chaque exécution, archivés ensuite puisque
 * R7 interdit de les supprimer. Au 11 septembre 2026, 1 075 comptes sur 1 089
 * venaient de là. Une base qu'on remet à zéro et que le premier `npm test`
 * repollue ne vaut rien : les tests ont désormais leur base, et la garde
 * `apps/api/src/garde-base-de-test.ts` les arrête s'ils visent la base de
 * travail.
 *
 * ============================================================== CE QU'IL FAIT
 *
 *   1. supprime `malica_test` si elle existe — c'est une base jetable, et elle
 *      seule : le nom est une constante, jamais un argument ;
 *   2. la recrée vide, puis y joue `db/migrer.mjs` — le même chemin que la CI
 *      et que la production, donc le schéma et le référentiel semés par les
 *      migrations, et aucune donnée de tenant ;
 *   3. écrit `apps/api/.env.test` (ignoré par git), que le script de test lit
 *      après `.env` : même serveur, même rôles, autre base, et un dossier de
 *      pièces hors du dépôt.
 *
 * Le rôle `malica_api` est global au serveur : on ne lui repose PAS de mot de
 * passe (`--mot-de-passe-api` le changerait aussi pour `malica_local`, et
 * l'API locale en mourrait). `.env.test` reprend donc celui de `.env`.
 *
 * Aucune URL n'est affichée.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const NOM = "malica_test";
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = join(RACINE, "apps", "api", ".env");
const ENV_TEST = join(RACINE, "apps", "api", ".env.test");
const PIECES = join(tmpdir(), "malica-test-pieces");

const lire = (cle) => {
  const ligne = readFileSync(ENV, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${cle}=`));
  if (!ligne) {
    console.error(
      `${cle} absente de apps/api/.env : impossible de savoir sur quel serveur monter la base de test.`,
    );
    process.exit(2);
  }
  return ligne
    .slice(cle.length + 1)
    .trim()
    .replace(/^"|"$/g, "");
};

/** La même URL, sur une autre base du même serveur. */
const surLaBase = (url, base) => {
  const u = new URL(url);
  u.pathname = `/${base}`;
  return u.toString();
};

const admin = lire("DATABASE_URL_ADMIN");
const api = lire("DATABASE_URL");
const adminTest = surLaBase(admin, NOM);
const apiTest = surLaBase(api, NOM);

// Deux verrous, parce qu'une faute ici supprimerait une base : la cible est
// bien `malica_test`, et ce n'est pas la base que désigne `.env`.
if (new URL(adminTest).pathname !== `/${NOM}` || new URL(admin).pathname === `/${NOM}`) {
  console.error(
    "Refus : la base visée n'est pas une base de test distincte de la base de travail.",
  );
  process.exit(2);
}

const maintenance = new pg.Client({ connectionString: surLaBase(admin, "postgres") });
await maintenance.connect();
try {
  // `with (force)` ferme les connexions restantes d'une exécution précédente.
  await maintenance.query(`drop database if exists ${NOM} with (force)`);
  await maintenance.query(`create database ${NOM}`);
} finally {
  await maintenance.end();
}
console.log(`base ${NOM} recréée, vide`);

const migrer = spawnSync(
  process.execPath,
  [join(RACINE, "db", "migrer.mjs"), "--base", adminTest],
  {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  },
);
if (migrer.status !== 0) {
  console.error(`db/migrer.mjs a échoué (code ${migrer.status}) : la base de test est incomplète.`);
  process.exit(1);
}
// Le détail fichier par fichier n'apprend rien ici : on garde le bilan.
console.log(migrer.stdout.trim().split("\n").at(-1));

mkdirSync(PIECES, { recursive: true });
writeFileSync(
  ENV_TEST,
  [
    "# Écrit par db/base-de-test.mjs — ne pas éditer à la main : relancer `npm run base-de-test`.",
    "# Lu par `npm test` APRÈS .env : il n'en remplace que ces trois lignes.",
    `DATABASE_URL=${apiTest}`,
    `DATABASE_URL_ADMIN=${adminTest}`,
    `STOCKAGE_RACINE=${PIECES.replace(/\\/g, "/")}`,
    "",
  ].join("\n"),
);
console.log("apps/api/.env.test écrit (base malica_test, pièces hors du dépôt)");
