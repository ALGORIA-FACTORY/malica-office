/**
 * Le registre se vérifie — les objets, pas le nombre de migrations.
 *
 *   node db/registre.mjs                          la base de travail (apps/api/.env) contre les migrations
 *   node db/registre.mjs --base <url>             une autre base contre les migrations
 *   node db/registre.mjs --catalogue <fichier>    un catalogue relevé ailleurs (psql -f db/registre.sql)
 *
 * ============================================================== POURQUOI
 *
 * Le 8 septembre 2026, `malica_local` a été « adoptée » : ses 93 migrations
 * ont été inscrites dans `app.migrations` sans être jouées, sur la foi d'une
 * base montée à la main par psql. Le registre disait les fichiers du dépôt ;
 * la base portait six objets d'une autre époque (neuf écarts : deux droits,
 * une table, sa vue, deux fonctions). Toutes les vérifications
 * qui comparaient des NOMBRES de migrations l'ont vu conforme.
 *
 * Ce script ne croit pas le registre sur parole. Il monte une base neuve
 * depuis les seules migrations du dépôt, relève le catalogue des deux et
 * nomme chaque écart.
 *
 * ============================================================== LE PÉRIMÈTRE
 *
 * Ce qui est comparé, et CE QUI NE L'EST PAS avec sa raison, est écrit en tête
 * de db/registre.sql — et nulle part ailleurs, pour qu'il n'y ait qu'une liste
 * à tenir. Une première version de ce contrôle (15 septembre 2026) ignorait
 * sans le dire les droits, la position des colonnes et les commentaires :
 * elle a annoncé trois objets divergents là où il y en avait six. Un outil de
 * contrôle qui écarte en silence cache ce qu'il devait trouver ; une exclusion
 * qui n'est pas écrite dans cet en-tête est un oubli.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(RACINE, "db", "migrations");
const REQUETE_CATALOGUE = readFileSync(join(RACINE, "db", "registre.sql"), "utf8");

/**
 * Écarts ACCEPTÉS, nommément : genre, objet, raison, date. Vide aujourd'hui.
 * Un écart qui disparaît rend le script rouge aussi — une exception périmée
 * ne reste pas dans la liste.
 */
const ECARTS_ACCEPTES = [];

/** Relève le catalogue d'une base : Map « genre objet » → définition. */
export async function lireCatalogue(client) {
  const { rows } = await client.query(REQUETE_CATALOGUE);
  return versCatalogue(rows);
}

export function versCatalogue(lignes) {
  const catalogue = new Map();
  for (const { genre, objet, definition } of lignes) {
    const cle = `${genre} ${objet}`;
    if (catalogue.has(cle)) throw new Error(`objet relevé deux fois : ${cle}`);
    catalogue.set(cle, String(definition ?? "").replace(/\r\n/g, "\n"));
  }
  return catalogue;
}

/**
 * Compare une base à la référence. Rend les écarts non acceptés et les
 * acceptations périmées (acceptées, mais plus constatées).
 */
export function comparerCatalogues(base, reference, acceptes = ECARTS_ACCEPTES) {
  const ecarts = [];
  for (const [cle, def] of reference) {
    if (!base.has(cle)) ecarts.push({ cle, nature: "absent de la base" });
    else if (base.get(cle) !== def)
      ecarts.push({ cle, nature: "différent", base: base.get(cle), reference: def });
  }
  for (const cle of base.keys()) {
    if (!reference.has(cle)) ecarts.push({ cle, nature: "en trop dans la base" });
  }
  const accepte = (e) => acceptes.some((a) => `${a.genre} ${a.objet}` === e.cle);
  const constates = new Set(ecarts.map((e) => e.cle));
  return {
    objets: reference.size,
    ecarts: ecarts.filter((e) => !accepte(e)),
    acceptes: ecarts.filter(accepte),
    perimes: acceptes.filter((a) => !constates.has(`${a.genre} ${a.objet}`)),
  };
}

/** Le registre dit-il les fichiers du dépôt, nom pour nom, empreinte pour empreinte ? */
export async function ecartsDuRegistre(client) {
  const { rows } = await client.query("select nom, sha256 from app.migrations");
  const inscrites = new Map(rows.map((r) => [r.nom, r.sha256]));
  const ecarts = [];
  for (const nom of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sha = createHash("sha256")
      .update(readFileSync(join(MIGRATIONS, nom), "utf8"))
      .digest("hex");
    if (!inscrites.has(nom)) ecarts.push(`${nom} : pas inscrite`);
    else if (inscrites.get(nom) !== sha) ecarts.push(`${nom} : inscrite avec une autre empreinte`);
    inscrites.delete(nom);
  }
  for (const nom of inscrites.keys()) ecarts.push(`${nom} : inscrite, absente du dépôt`);
  return ecarts;
}

/**
 * Monte une base jetable depuis les seules migrations, sur le même serveur
 * que `urlAdmin`. Rend son URL et de quoi la supprimer.
 */
export async function monterBaseDesMigrations(urlAdmin) {
  const nom = `malica_registre_${process.pid}_${Date.now()}`;
  const url = new URL(urlAdmin);
  url.pathname = `/${nom}`;
  const surLeServeur = async (sql) => {
    const admin = new pg.Client({ connectionString: urlAdmin });
    await admin.connect();
    try {
      await admin.query(sql);
    } finally {
      await admin.end();
    }
  };
  const supprimer = () => surLeServeur(`drop database if exists ${nom} with (force)`);
  await surLeServeur(`create database ${nom}`);
  const r = spawnSync(process.execPath, [join(RACINE, "db", "migrer.mjs"), "--base", url.href], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    await supprimer();
    throw new Error(`les migrations ne se montent pas :\n${r.stderr || r.stdout}`);
  }
  return { url: url.href, supprimer };
}

/** Le catalogue que produisent les migrations : base jetable, relevée, supprimée quoi qu'il arrive. */
async function catalogueDesMigrations(urlAdmin) {
  const base = await monterBaseDesMigrations(urlAdmin);
  try {
    const client = new pg.Client({ connectionString: base.url });
    await client.connect();
    try {
      return await lireCatalogue(client);
    } finally {
      await client.end();
    }
  } finally {
    await base.supprimer();
  }
}

export function urlDeTravail() {
  const env = join(RACINE, "apps", "api", ".env");
  if (!existsSync(env)) return null;
  const ligne = readFileSync(env, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_URL_ADMIN="));
  return ligne ? ligne.slice("DATABASE_URL_ADMIN=".length).trim() : null;
}

function decrire(resultat) {
  const lignes = [`${resultat.objets} objets dans la base montée depuis les migrations.`];
  for (const e of resultat.ecarts) {
    lignes.push(`ÉCART  ${e.cle} — ${e.nature}`);
    if (e.nature === "différent")
      lignes.push(`  base      : ${e.base}`, `  migrations: ${e.reference}`);
  }
  for (const e of resultat.acceptes) lignes.push(`accepté  ${e.cle} — ${e.nature}`);
  for (const a of resultat.perimes)
    lignes.push(`PÉRIMÉ  ${a.genre} ${a.objet} — accepté, mais plus constaté`);
  lignes.push(
    `${resultat.ecarts.length} écart(s), ${resultat.acceptes.length} accepté(s), ${resultat.perimes.length} périmé(s).`,
  );
  return lignes.join("\n");
}

async function principal() {
  const args = process.argv.slice(2);
  const option = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : null;
  };
  const urlAdmin = option("--base") ?? urlDeTravail();
  if (!urlAdmin) {
    console.error("Aucune base : --base <url>, ou DATABASE_URL_ADMIN dans apps/api/.env.");
    process.exit(2);
  }
  const reference = await catalogueDesMigrations(urlAdmin);
  let base;
  const fichier = option("--catalogue");
  if (fichier) {
    base = versCatalogue(JSON.parse(readFileSync(fichier, "utf8")));
  } else {
    const client = new pg.Client({ connectionString: urlAdmin });
    await client.connect();
    try {
      const registre = await ecartsDuRegistre(client);
      for (const e of registre) console.log(`REGISTRE  ${e}`);
      base = await lireCatalogue(client);
      if (registre.length) process.exitCode = 1;
    } finally {
      await client.end();
    }
  }
  const resultat = comparerCatalogues(base, reference);
  console.log(decrire(resultat));
  if (resultat.ecarts.length || resultat.perimes.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await principal();
