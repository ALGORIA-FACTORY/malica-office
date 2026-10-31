/**
 * Importer des cours de change officiels — le geste de l'exploitation.
 *
 * ===================================================================== USAGE
 *
 *   DATABASE_URL_ADMIN=<url> node outils/importer-les-cours.mjs cours.csv
 *   DATABASE_URL_ADMIN=<url> node outils/importer-les-cours.mjs cours.csv --essai
 *
 * Le fichier est fourni par la personne qui importe, relevé à la source
 * officielle qu'il nomme (la BCT, la BCEAO…). Aucun cours n'est livré par le
 * dépôt : un cours est une donnée, pas une constante. Une ligne d'en-tête,
 * puis une ligne par cours, séparées par des virgules :
 *
 *   date,devise,vers_devise,taux,unite,source
 *   2026-09-10,EUR,TND,3.3456,1,BCT
 *   2026-09-10,JPY,TND,20.1234,1000,BCT
 *
 * `unite` unités de `devise` valent `taux` unités de `vers_devise` ; le taux
 * s'écrit avec un POINT décimal, tel qu'il est publié, sans arrondi.
 *
 * ================================================================= CE QUI EST SÛR
 *
 *   — tout ou rien : une seule ligne illisible, et rien n'est importé ; chaque
 *     faute est dite avec son numéro de ligne ;
 *   — rejouer le même fichier n'ajoute rien (index unique de
 *     `parametrage.cours_de_change`) ; un cours CORRIGÉ s'importe comme une
 *     ligne nouvelle, et la plus récente fait foi (R7) — rien n'est réécrit ;
 *   — chaque ligne importée porte son lot : le nom du fichier et son
 *     empreinte, pour savoir d'où vient un cours ;
 *   — la base refuse une devise ou une source qu'elle ne connaît pas
 *     (clés étrangères vers `ref.devises`, `ref.sources_de_cours`).
 *
 * Les cours importés valent pour tous les dossiers. Un cabinet saisit les
 * siens à l'écran (`cours_de_change_saisir`) ; à date égale, le sien
 * l'emporte pour ses dossiers (`app.cours_applicable`). L'URL n'est jamais
 * affichée.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

const ENTETE = ["date", "devise", "vers_devise", "taux", "unite", "source"];

/**
 * Les cours d'un fichier, relus et vérifiés. Pure : rend `{ cours, fautes }`,
 * une faute par ligne illisible, avec son numéro.
 */
export function lireLesCours(texte) {
  const lignes = texte.replace(/^﻿/, "").split(/\r?\n/);
  const fautes = [];
  const cours = [];
  const entete = (lignes[0] ?? "").split(",").map((c) => c.trim());
  if (entete.join(",") !== ENTETE.join(",")) {
    fautes.push(`ligne 1 : en-tête attendu « ${ENTETE.join(",")} »`);
    return { cours, fautes };
  }
  lignes.slice(1).forEach((brute, i) => {
    const n = i + 2;
    if (brute.trim() === "") return;
    const champs = brute.split(",").map((c) => c.trim());
    if (champs.length !== ENTETE.length) {
      fautes.push(`ligne ${n} : ${ENTETE.length} champs attendus, ${champs.length} lus`);
      return;
    }
    const [date, devise, versDevise, taux, unite, source] = champs;
    const jour = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!jour || Number.isNaN(jour.getTime()) || jour.toISOString().slice(0, 10) !== date)
      fautes.push(`ligne ${n} : date « ${date} » illisible (AAAA-MM-JJ)`);
    else if (!/^[A-Z]{3}$/.test(devise) || !/^[A-Z]{3}$/.test(versDevise))
      fautes.push(`ligne ${n} : code de devise ISO 4217 attendu`);
    else if (devise === versDevise) fautes.push(`ligne ${n} : une devise ne se change pas en elle-même`);
    else if (!/^\d+(\.\d+)?$/.test(taux) || !/[1-9]/.test(taux))
      fautes.push(`ligne ${n} : taux « ${taux} » illisible (positif, point décimal)`);
    else if (!/^10*$/.test(unite)) fautes.push(`ligne ${n} : unité « ${unite} » (1, 10, 100…)`);
    else if (!/^[A-Z][A-Z0-9_]*$/.test(source)) fautes.push(`ligne ${n} : source « ${source} » illisible`);
    else cours.push({ date, devise, versDevise, taux, unite: Number(unite), source });
  });
  return { cours, fautes };
}

/**
 * Inscrit les cours, en une transaction : rend combien étaient nouveaux. Le
 * lot nomme le fichier. Un cours déjà là n'ajoute rien.
 */
export async function importerLesCours(client, cours, lot) {
  await client.query("begin");
  try {
    let nouveaux = 0;
    for (const c of cours) {
      const { rowCount } = await client.query(
        `insert into parametrage.cours_de_change
           (devise, vers_devise, date_du_cours, taux, unite, source, import_lot)
         values ($1, $2, $3::date, $4::numeric, $5, $6, $7)
         on conflict (devise, vers_devise, date_du_cours, source, taux, unite)
           where tenant_id is null
         do nothing`,
        [c.devise, c.versDevise, c.date, c.taux, c.unite, c.source, lot],
      );
      nouveaux += rowCount ?? 0;
    }
    await client.query("commit");
    return nouveaux;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

async function principal() {
  const fichier = process.argv[2];
  const essai = process.argv.includes("--essai");
  if (!fichier) {
    console.error("Usage : node outils/importer-les-cours.mjs <cours.csv> [--essai]");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) {
    console.error("DATABASE_URL_ADMIN absente : la base où importer.");
    process.exit(2);
  }
  const texte = readFileSync(fichier, "utf8");
  const { cours, fautes } = lireLesCours(texte);
  if (fautes.length > 0) {
    console.error(`Rien n'est importé — ${fautes.length} ligne(s) à corriger :`);
    for (const f of fautes) console.error(`  ${f}`);
    process.exit(1);
  }
  const lot = `${basename(fichier)}#${createHash("sha256").update(texte).digest("hex").slice(0, 12)}`;
  if (essai) {
    console.log(`Essai : ${cours.length} cours lus, rien n'est importé (lot ${lot}).`);
    return;
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const nouveaux = await importerLesCours(client, cours, lot);
    console.log(
      `${cours.length} cours lus, ${nouveaux} nouveau(x), ${cours.length - nouveaux} déjà là (lot ${lot}).`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => {
    console.error(`Import interrompu, rien n'est importé : ${e.message}`);
    process.exit(1);
  });
}
