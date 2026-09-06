/**
 * L'exécuteur de migrations — le seul chemin par lequel le schéma se monte.
 *
 * ============================================================== POURQUOI
 *
 * La CI jouait `db/migrations/*.sql` en boucle, tout, à chaque fois, sur une
 * base neuve. Un serveur qui vit ne se recrée pas : il faut savoir ce qui a
 * déjà été appliqué, appliquer le reste, et refuser en silence rien du tout.
 * Ce script tient la table `app.migrations` (nom, empreinte, date) et joue
 * chaque fichier absent dans une transaction, dans l'ordre des noms.
 *
 * Un fichier déjà appliqué dont l'empreinte a changé arrête tout : la source
 * de vérité est le dépôt, et une migration se corrige par une migration
 * nouvelle, jamais en réécrivant l'ancienne. `--forcer` lève ce garde-fou,
 * pour l'atelier seulement, et le dit.
 *
 * Le fichier de compatibilité `db/local/00_compat_supabase.sql` — le schéma
 * `auth`, les rôles, `auth.uid()` — se joue avant, à chaque fois : il est
 * idempotent, et un PostgreSQL nu ne connaît rien de tout cela.
 *
 *   node db/migrer.mjs                       DATABASE_URL_ADMIN d'apps/api/.env
 *   node db/migrer.mjs --base <url>          une autre base (une base jetable)
 *   node db/migrer.mjs --mot-de-passe-api    pose REGALICA_API_PASSWORD sur le rôle de l'API
 *   node db/migrer.mjs --forcer              rejoue un fichier dont l'empreinte a changé
 *   node db/migrer.mjs --adopter             une base montée par psql : inscrit l'existant sans le jouer
 *
 * L'URL n'est jamais affichée. Les messages français des migrations exigent
 * un client en UTF-8 : `pg` l'est toujours — c'est ce qui a manqué à psql.
 *
 * Un rôle PostgreSQL est global au serveur, pas à une base : `--mot-de-passe-api`
 * sur une base jetable change le mot de passe de `regalica_api` pour TOUTES
 * les bases du même serveur — sur un poste, l'API locale en meurt. Sur un
 * serveur de production, c'est l'intention ; sur un poste, on s'en passe.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { decouperSql } from "./decouper-sql.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(RACINE, "db", "migrations");
const COMPAT = join(RACINE, "db", "local", "00_compat_supabase.sql");

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? (args[i + 1] ?? true) : null;
};

function urlDeLaBase() {
  const declaree = option("--base");
  if (typeof declaree === "string") return declaree;
  if (process.env["DATABASE_URL_ADMIN"]) return process.env["DATABASE_URL_ADMIN"];
  const env = join(RACINE, "apps", "api", ".env");
  if (existsSync(env)) {
    const ligne = readFileSync(env, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL_ADMIN="));
    if (ligne) return ligne.slice("DATABASE_URL_ADMIN=".length).trim();
  }
  console.error("Aucune base : DATABASE_URL_ADMIN absente, et pas de --base.");
  process.exit(2);
}

const empreinte = (texte) => createHash("sha256").update(texte).digest("hex");

/*
 * Les migrations ont été écrites pour psql, et une d'elles porte une
 * méta-commande (`\set ON_ERROR_STOP on`). Le pilote `pg` ne connaît que le
 * SQL : cette ligne-là est retirée — le script s'arrête déjà à la première
 * erreur — et toute autre méta-commande arrête tout, plutôt que d'être
 * envoyée au serveur comme du SQL cassé ou ignorée en silence (`\i` inclurait
 * un fichier que personne ne jouerait).
 */
function sansMetaCommandes(nom, sql) {
  return sql
    .split("\n")
    .filter((ligne) => {
      if (!ligne.startsWith("\\")) return true;
      if (/^\\set\s+ON_ERROR_STOP\b/.test(ligne)) return false;
      console.error(
        `\n${nom} contient une méta-commande psql que migrer.mjs ne joue pas : ${ligne.trim()}\n`,
      );
      process.exit(1);
    })
    .join("\n");
}

const client = new pg.Client({ connectionString: urlDeLaBase() });
await client.connect();
await client.query("set client_encoding to 'UTF8'");

try {
  // La compatibilité d'abord : schéma auth, rôles, auth.uid(). Idempotent.
  await client.query(readFileSync(COMPAT, "utf8"));

  await client.query("create schema if not exists app");
  await client.query(`
    create table if not exists app.migrations (
      nom         text primary key,
      sha256      text not null,
      applique_le timestamptz not null default now()
    )`);

  const { rows } = await client.query("select nom, sha256 from app.migrations");
  const appliquees = new Map(rows.map((r) => [r.nom, r.sha256]));

  const fichiers = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  /*
   * Une base montée avant ce script (les postes de développement, par psql)
   * porte déjà tout le schéma mais pas la table. `--adopter` y inscrit les
   * fichiers présents comme appliqués, sans les jouer, et seulement si la
   * table est vide : ensuite, seules les migrations nouvelles se jouent.
   */
  if (option("--adopter") !== null) {
    if (appliquees.size > 0) {
      console.error("--adopter : app.migrations n'est pas vide, rien à adopter.");
      process.exit(1);
    }
    for (const nom of fichiers) {
      const sha = empreinte(readFileSync(join(MIGRATIONS, nom), "utf8"));
      await client.query("insert into app.migrations (nom, sha256) values ($1, $2)", [nom, sha]);
      appliquees.set(nom, sha);
    }
    console.log(`  ${fichiers.length} migrations adoptées comme déjà appliquées`);
  }

  let jouees = 0;
  for (const nom of fichiers) {
    const source = readFileSync(join(MIGRATIONS, nom), "utf8");
    // L'empreinte est celle du fichier tel qu'il est dans le dépôt.
    const sha = empreinte(source);
    const sql = sansMetaCommandes(nom, source);
    const connue = appliquees.get(nom);
    if (connue === sha) continue;
    if (connue && option("--forcer") === null) {
      console.error(
        `\n${nom} a déjà été appliquée avec une autre empreinte.\n` +
          "Une migration ne se réécrit pas : écrivez-en une nouvelle. (--forcer pour l'atelier)\n",
      );
      process.exit(1);
    }
    /*
     * `create index concurrently` refuse toute transaction, et un lot envoyé
     * d'un coup en est une. Ces fichiers-là s'exécutent instruction par
     * instruction, sans transaction : ils sont écrits idempotents, et se
     * rejouent tels quels si l'un des pas tombe.
     */
    const sansTransaction = /\bconcurrently\b/i.test(sql);
    const enregistrer = () =>
      client.query(
        `insert into app.migrations (nom, sha256) values ($1, $2)
           on conflict (nom) do update set sha256 = excluded.sha256, applique_le = now()`,
        [nom, sha],
      );
    try {
      if (sansTransaction) {
        for (const instruction of decouperSql(sql)) await client.query(instruction);
        await enregistrer();
      } else {
        await client.query("begin");
        await client.query(sql);
        await enregistrer();
        await client.query("commit");
      }
    } catch (erreur) {
      if (!sansTransaction) await client.query("rollback").catch(() => undefined);
      console.error(`\nÉCHEC ${nom} : ${erreur.message}\n`);
      process.exit(1);
    }
    console.log(`  ${connue ? "rejouée" : "appliquée"}  ${nom}`);
    jouees += 1;
  }

  if (option("--mot-de-passe-api") !== null) {
    const mdp = process.env["REGALICA_API_PASSWORD"];
    if (!mdp) {
      console.error("REGALICA_API_PASSWORD absente : le rôle de l'API garde son mot de passe.");
      process.exit(2);
    }
    // Pas de paramètre lié possible sur un ALTER ROLE : le mot de passe est
    // cité par le pilote, jamais concaténé à la main.
    await client.query(`alter role regalica_api with password ${pg.escapeLiteral(mdp)}`);
    console.log("  mot de passe posé sur regalica_api");
  }

  console.log(
    `\n${fichiers.length} migrations, ${jouees} jouée(s), ${fichiers.length - jouees} déjà à jour.\n`,
  );
} finally {
  await client.end();
}
