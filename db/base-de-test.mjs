/**
 * Prépare la base de test du poste — `malica_test` — depuis les migrations seules.
 *
 *   npm run base-de-test
 *
 * ============================================================== POURQUOI
 *
 * Les tests de l'API écrivaient dans la base de travail, `malica_local` : un
 * compte et deux organisations à chaque exécution, archivés ensuite puisque
 * R7 interdit de les supprimer. Au 11 septembre 2026, 1 075 comptes sur 1 089
 * venaient de là. Les tests ont donc leur base, et la garde
 * `apps/api/src/garde-base-de-test.ts` les arrête s'ils visent la base de
 * travail.
 *
 * ============================================================== PRÉALABLE
 *
 * Toutes les bases vivent sur le serveur partagé (`pg-shared`), et aucun
 * projet n'y crée de base. `malica_test` est posée une fois, par l'exploitant,
 * puis confiée au rôle d'administration de Malica (celui de `.env`, qui joue
 * déjà les migrations de `malica`) :
 *
 *   cd /home/lab/pg-shared && ./create-db.sh malica_test malica_test pgcrypto vector btree_gist
 *   psql -d postgres -c "ALTER DATABASE malica_test OWNER TO malica;"
 *
 * Ce script ne crée rien : il exige que `malica_test` existe et appartienne au
 * rôle d'administration, puis il y joue `db/migrer.mjs` — le même chemin que la
 * CI et que la production, donc le schéma et le référentiel semés par les
 * migrations, et aucune donnée de tenant. Il n'a besoin d'aucun mot de passe
 * de plus que `apps/api/.env`.
 *
 * ============================================================== CE QU'IL ÉCRIT
 *
 * `apps/api/.env.test` (ignoré par git, mode 600), que le script de test lit
 * après `.env` : même serveur, mêmes rôles, autre base, et un dossier de
 * pièces hors du dépôt.
 *
 * Aucune URL n'est affichée.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Deux verrous, parce qu'une faute ici migrerait la base de travail : la cible
// est bien `malica_test`, et ce n'est pas la base que désigne `.env`.
if (new URL(adminTest).pathname !== `/${NOM}` || new URL(admin).pathname === `/${NOM}`) {
  console.error(
    "Refus : la base visée n'est pas une base de test distincte de la base de travail.",
  );
  process.exit(2);
}

// La base doit exister et appartenir au rôle d'administration : ce script ne
// crée rien, le serveur partagé l'interdit aux projets.
const maintenance = new pg.Client({ connectionString: surLaBase(admin, "postgres") });
await maintenance.connect();
let proprietaire;
try {
  const r = await maintenance.query(
    "select pg_get_userbyid(datdba) as proprio from pg_database where datname = $1",
    [NOM],
  );
  proprietaire = r.rows[0]?.proprio;
} finally {
  await maintenance.end();
}
const roleAdmin = decodeURIComponent(new URL(admin).username);
if (proprietaire !== roleAdmin) {
  console.error(
    `La base ${NOM} n'existe pas ou n'appartient pas à ${roleAdmin} (propriétaire : ${proprietaire ?? "aucun"}).\n` +
      "Voir le préalable en tête de db/base-de-test.mjs.",
  );
  process.exit(2);
}
console.log(`base ${NOM} atteinte avec le rôle ${roleAdmin}`);

/** Joue les migrations ; rend le code de sortie et tout ce qu'elles ont écrit. */
const jouerLesMigrations = () => {
  const r = spawnSync(process.execPath, [join(RACINE, "db", "migrer.mjs"), "--base", adminTest], {
    encoding: "utf8",
  });
  return { status: r.status, sortie: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

// Les migrations remettent des objets à des rôles propriétaires (`alter
// function … owner to portier`, `alter table … owner to greffier`). PostgreSQL
// l'autorise à un superutilisateur, ou si le nouveau propriétaire a le droit
// CREATE sur le schéma de l'objet. Le serveur partagé ne donne pas de
// superutilisateur à Malica : le script accorde donc CREATE à ces rôles sur le
// schéma qui le réclame, dans cette base seulement, le temps des migrations, et
// le retire ensuite. Les épreuves des droits retrouvent ainsi l'état de la
// production. Les rôles sont ceux que les migrations nomment elles-mêmes
// (`owner to <rôle>`) : aucune liste n'est écrite ici.
const proprietaires = [
  ...new Set(
    readdirSync(join(RACINE, "db", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) =>
        [
          ...readFileSync(join(RACINE, "db", "migrations", f), "utf8").matchAll(
            /owner to ([a-z_][a-z0-9_]*)/gi,
          ),
        ].map((m) => m[1].toLowerCase()),
      ),
  ),
];

const accordes = [];
const base = new pg.Client({ connectionString: adminTest });
await base.connect();
let resultat;
try {
  // La base n'est ouverte à personne par défaut (create-db.sh retire PUBLIC) :
  // le rôle de l'API s'y connecte avec ce seul droit, que le propriétaire donne.
  const roleApi = decodeURIComponent(new URL(api).username);
  if (!/^[a-z_][a-z0-9_]*$/.test(roleApi))
    throw new Error("rôle de l'API illisible dans apps/api/.env");
  await base.query(`grant connect on database "${NOM}" to "${roleApi}"`);
  for (let essai = 0; essai < 30; essai++) {
    resultat = jouerLesMigrations();
    if (resultat.status === 0) break;
    const schema = /permission denied for schema ([a-z_][a-z0-9_]*)/.exec(resultat.sortie)?.[1];
    if (!schema || accordes.some((a) => a.schema === schema)) break;
    // Un schéma créé par la migration qui échoue est défait avec elle : on le
    // pose d'avance (toutes les migrations écrivent `create schema if not exists`).
    const present = (
      await base.query("select to_regnamespace($1) is not null as present", [schema])
    ).rows[0].present;
    if (!present) await base.query(`create schema "${schema}"`);
    let accorde = false;
    for (const role of proprietaires) {
      const existe =
        (await base.query("select 1 from pg_roles where rolname = $1", [role])).rowCount > 0;
      if (!existe) continue;
      const deja = (
        await base.query("select has_schema_privilege($1, $2, 'CREATE') as deja", [role, schema])
      ).rows[0].deja;
      if (deja) continue;
      await base.query(`grant create on schema "${schema}" to "${role}"`);
      accordes.push({ schema, role });
      accorde = true;
      console.log(`${role} : CREATE sur le schéma ${schema}, le temps des migrations`);
    }
    if (!accorde) break;
  }
} finally {
  for (const { schema, role } of accordes) {
    await base.query(`revoke create on schema "${schema}" from "${role}"`);
  }
  await base.end();
}
if (resultat?.status !== 0) {
  console.error(resultat?.sortie.trim().split("\n").slice(-12).join("\n"));
  console.error(
    `db/migrer.mjs a échoué (code ${resultat?.status}) : la base de test est incomplète.`,
  );
  process.exit(1);
}
if (accordes.length > 0) console.log(`${accordes.length} droit(s) CREATE temporaire(s) retiré(s)`);
// Le détail fichier par fichier n'apprend rien ici : on garde le bilan.
console.log(resultat.sortie.trim().split("\n").at(-1));

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
chmodSync(ENV_TEST, 0o600);
console.log("apps/api/.env.test écrit (base malica_test, mode 600, pièces hors du dépôt)");
