/**
 * Importer des cours de change officiels — le geste de l'exploitation.
 *
 * ===================================================================== USAGE
 *
 *   DATABASE_URL_ADMIN=<url> MALICA_OPERATEUR=<qui> node outils/importer-les-cours.mjs cours.csv
 *   DATABASE_URL_ADMIN=<url> node outils/importer-les-cours.mjs cours.csv --essai
 *
 * Le fichier est fourni par la personne qui importe, relevé à la source
 * officielle qu'il nomme (la BCT, la BCEAO…). Aucun cours n'est livré par le
 * dépôt : un cours est une donnée, pas une constante. Une ligne d'en-tête,
 * puis une ligne par cours, séparées par des virgules ; la colonne `motif`
 * est facultative, et dernière (elle peut contenir des virgules) :
 *
 *   date,devise,vers_devise,taux,unite,source,motif
 *   2026-09-10,EUR,TND,3.3456,1,BCT,
 *   2026-09-10,JPY,TND,20.1234,1000,BCT,
 *   2026-09-11,EUR,TND,3.3401,1,BCT,Rectificatif publié par la BCT le 12/09
 *
 * `unite` unités de `devise` valent `taux` unités de `vers_devise` ; le taux
 * s'écrit avec un POINT décimal, tel qu'il est publié, sans arrondi.
 *
 * ================================================================= CE QUI EST SÛR
 *
 *   — tout ou rien : une seule ligne illisible, et rien n'est importé ; chaque
 *     faute est dite avec son numéro de ligne ;
 *   — rejouer le même fichier n'ajoute rien : un cours identique au dernier
 *     importé de sa clé est ignoré (`app.cours_de_change_une_fois`) ;
 *   — un cours CORRIGÉ s'importe comme une ligne nouvelle, et la plus récente
 *     fait foi (R7) ; une correction dit pourquoi (`motif`), y compris le
 *     RETOUR à une valeur officielle antérieure — la base refuse une correction
 *     sans motif, et tout le fichier avec elle ;
 *   — chaque import est TRACÉ (`parametrage.cours_de_change_imports`, en ajout
 *     seul) : le fichier et son empreinte, ce qu'il a lu, ajouté, corrigé, et
 *     qui l'a lancé (`MALICA_OPERATEUR`, exigé) ; chaque cours importé pointe
 *     son import ;
 *   — la base refuse une devise ou une source qu'elle ne connaît pas
 *     (clés étrangères vers `ref.devises`, `ref.sources_de_cours`).
 *
 * Les cours importés sont les cours OFFICIELS, pour tous les dossiers : à
 * date égale, ils passent devant un cours saisi par un cabinet ; seule une
 * dérogation motivée du cabinet passe devant eux (`ref.rangs_des_cours`,
 * `app.cours_applicable`). L'URL n'est jamais affichée.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

const ENTETE = ["date", "devise", "vers_devise", "taux", "unite", "source"];
/** La colonne facultative, dernière : le motif d'une correction. */
const MOTIF = "motif";

/**
 * Les cours d'un fichier, relus et vérifiés. Pure : rend `{ cours, fautes }`,
 * une faute par ligne illisible, avec son numéro.
 */
export function lireLesCours(texte) {
  const lignes = texte.replace(/^\uFEFF/, "").split(/\r?\n/);
  const fautes = [];
  const cours = [];
  const entete = (lignes[0] ?? "").split(",").map((c) => c.trim());
  const avecMotif = entete.join(",") === [...ENTETE, MOTIF].join(",");
  if (!avecMotif && entete.join(",") !== ENTETE.join(",")) {
    fautes.push(`ligne 1 : en-tête attendu « ${ENTETE.join(",")}[,${MOTIF}] »`);
    return { cours, fautes };
  }
  // Une ligne qui RÉPÈTE la ligne précédente de son cours (même jour, mêmes
  // devises, même source, même taux, même unité) se nomme : elle ne serait
  // pas inscrite, et l'import tomberait sur un message trompeur (revue de
  // #148). Une ligne qui la corrige, motivée, reste permise — y compris pour
  // revenir à une valeur antérieure.
  const derniere = new Map();
  // Un taux s'écrit de plusieurs façons (« 3.30 », « 3.3 ») : il se compare
  // sous sa forme réduite, comme la base le compare.
  const reduit = (t) =>
    t
      .replace(/^0+(?=\d)/, "")
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "");
  lignes.slice(1).forEach((brute, i) => {
    const n = i + 2;
    if (brute.trim() === "") return;
    const tous = brute.split(",");
    // Le motif est le reste de la ligne : il peut porter des virgules.
    const champs = (avecMotif ? tous.slice(0, ENTETE.length) : tous).map((c) => c.trim());
    if (avecMotif ? tous.length < ENTETE.length + 1 : champs.length !== ENTETE.length) {
      fautes.push(
        `ligne ${n} : ${ENTETE.length + (avecMotif ? 1 : 0)} champs attendus, ${tous.length} lus`,
      );
      return;
    }
    const motif = avecMotif ? tous.slice(ENTETE.length).join(",").trim() || null : null;
    const [date, devise, versDevise, taux, unite, source] = champs;
    const cle = `${date}|${devise}|${versDevise}|${source}`;
    const valeur = `${reduit(taux)}/${unite}`;
    const jour = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!jour || Number.isNaN(jour.getTime()) || jour.toISOString().slice(0, 10) !== date)
      fautes.push(`ligne ${n} : date « ${date} » illisible (AAAA-MM-JJ)`);
    else if (!/^[A-Z]{3}$/.test(devise) || !/^[A-Z]{3}$/.test(versDevise))
      fautes.push(`ligne ${n} : code de devise ISO 4217 attendu`);
    else if (devise === versDevise)
      fautes.push(`ligne ${n} : une devise ne se change pas en elle-même`);
    else if (!/^\d+(\.\d+)?$/.test(taux) || !/[1-9]/.test(taux))
      fautes.push(`ligne ${n} : taux « ${taux} » illisible (positif, point décimal)`);
    else if (!/^10*$/.test(unite)) fautes.push(`ligne ${n} : unité « ${unite} » (1, 10, 100…)`);
    else if (!/^[A-Z][A-Z0-9_]*$/.test(source))
      fautes.push(`ligne ${n} : source « ${source} » illisible`);
    else if (derniere.get(cle)?.valeur === valeur)
      fautes.push(`ligne ${n} : répète la ligne ${derniere.get(cle).n}`);
    else {
      derniere.set(cle, { n, valeur });
      cours.push({ date, devise, versDevise, taux, unite: Number(unite), source, motif });
    }
  });
  return { cours, fautes };
}

/**
 * Ce que chaque cours ferait, au regard du dernier cours importé de sa clé :
 * `nouveau` (aucun), `identique` (le même taux pour la même unité : rien),
 * `correction` (un autre : une ligne nouvelle, motivée).
 */
async function classer(client, c) {
  const { rows } = await client.query(
    `select taux = $5::numeric and unite = $6 as identique
       from parametrage.cours_de_change
      where origine = 'import' and tenant_id is null and dossier_id is null
        and devise = $1 and vers_devise = $2 and date_du_cours = $3::date and source = $4
      order by saisi_le desc, id desc
      limit 1`,
    [c.devise, c.versDevise, c.date, c.source, c.taux, c.unite],
  );
  if (rows.length === 0) return "nouveau";
  return rows[0].identique ? "identique" : "correction";
}

/**
 * Inscrit les cours, en une transaction : l'import d'abord, tracé (le lot, ce
 * qu'il a lu, ajouté, corrigé, et qui l'a lancé), puis chaque cours, qui le
 * pointe. Rend `{ nouveaux, corrections, identiques }`. Une correction sans
 * motif est refusée par la base, et rien n'est importé.
 */
export async function importerLesCours(client, cours, lot, par) {
  await client.query("begin");
  try {
    // Chaque cours se classe au regard du dernier cours de sa clé : celui
    // d'une ligne précédente du fichier, sinon celui de la base.
    const classes = [];
    const dernier = new Map();
    for (const c of cours) {
      const k = [c.date, c.devise, c.versDevise, c.source].join("|");
      const avant = dernier.get(k);
      // Une ligne qui répète la précédente est refusée à la lecture : la
      // suivante, différente, la corrige.
      classes.push(avant ? "correction" : await classer(client, c));
      dernier.set(k, c);
    }
    const compte = (k) => classes.filter((x) => x === k).length;
    const bilan = {
      nouveaux: compte("nouveau"),
      corrections: compte("correction"),
      identiques: compte("identique"),
    };
    const {
      rows: [importe],
    } = await client.query(
      `insert into parametrage.cours_de_change_imports (lot, lus, nouveaux, corrections, par)
       values ($1, $2, $3, $4, $5) returning id`,
      [lot, cours.length, bilan.nouveaux, bilan.corrections, par],
    );
    for (const [i, c] of cours.entries()) {
      if (classes[i] === "identique") continue;
      const { rowCount } = await client.query(
        `insert into parametrage.cours_de_change
           (origine, devise, vers_devise, date_du_cours, taux, unite, source, motif, import_id)
         values ('import', $1, $2, $3::date, $4::numeric, $5, $6, $7, $8)`,
        [c.devise, c.versDevise, c.date, c.taux, c.unite, c.source, c.motif, importe.id],
      );
      // Le bilan tracé est celui de la base : un écart n'est jamais tu.
      if (rowCount !== 1)
        throw new Error(`le cours ${c.devise}/${c.versDevise} du ${c.date} n'a pas été inscrit`);
    }
    await client.query("commit");
    return bilan;
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
  const par = process.env.MALICA_OPERATEUR?.trim();
  if (!essai && !par) {
    console.error("MALICA_OPERATEUR absente : qui lance l'import (il est tracé).");
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
    const b = await importerLesCours(client, cours, lot, par);
    console.log(
      `${cours.length} cours lus, ${b.nouveaux} nouveau(x), ${b.corrections} correction(s), ` +
        `${b.identiques} déjà là (lot ${lot}).`,
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
