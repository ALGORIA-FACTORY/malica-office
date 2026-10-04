/**
 * Les textes qui ne se decoupent pas en articles : notes communes et normes
 * comptables.
 *
 * ====================================================== POURQUOI ELLES COMPTENT
 *
 * Une note commune n'est pas une loi. Elle n'oblige QUE l'administration
 * fiscale — article 54 de la loi de finances complementaire 2012 — ni le
 * contribuable, ni le juge. C'est precisement ce qui la rend utile : elle dit
 * comment l'administration lira le texte, donc ce que le contribuable peut lui
 * opposer. La base porte cette distinction dans `legal.sources`, et chaque note
 * y est rattachee par `source_code = 'NOTE_COMMUNE'`.
 *
 * ====================================================== LE MODELE RETENU
 *
 * Une note commune n'est pas decoupee en articles : c'est un texte suivi qui
 * commente un ou plusieurs articles d'une loi. La decouper serait inventer une
 * structure qu'elle n'a pas. UNE NOTE = UN TEXTE :
 *
 *   corpus  NC-<annee>      numero  <numero de la note>
 *
 * comme une loi de finances, ou l'article 10 de la LF 1995 n'a rien a voir avec
 * celui de la LF 2026. Le fragmenteur decoupe ensuite le texte en morceaux de
 * lecture ; la recherche remonte donc au passage exact, dans la note exacte.
 *
 * ====================================================== CE QU'IL NE FAIT PAS
 *
 * Il ne touche a rien d'autre que les corpus NC-*. Il est reprenable : les PDF
 * deja telecharges ne le sont pas deux fois, et une note deja ecrite est mise a
 * jour, pas dupliquee.
 *
 *   bun db/corpus/notes.mjs [--sec] [--limite N] [--seulement <motif>]
 *
 * BUN, PAS NODE : voir l'en-tete de vectoriser.mjs.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ICI = dirname(fileURLToPath(import.meta.url));
// La racine du dépôt se déduit d'ici : un chemin absolu écrit en dur suit la
// machine qui l'a écrit, et meurt au premier déménagement. Celui-ci pointait
// encore un dossier OneDrive disparu (constaté le 4 octobre 2026).
const DEPOT = join(ICI, "..", "..");
const { default: pg } = await import(
  pathToFileURL(join(DEPOT, "node_modules/pg/lib/index.js")).href
);
const pdfjs = await import(
  pathToFileURL(join(DEPOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href
);

function env(fichier) {
  const v = {};
  try {
    for (const l of readFileSync(join(DEPOT, fichier), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
      if (m) v[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* le .env manquant leve plus bas */
  }
  return v;
}
const API = env("apps/api/.env");

/** PostgreSQL refuse l'octet nul et les demi-paires de substitution. */
function nettoyerTexte(t) {
  return t
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

/**
 * Le numero de la note, lu sur son titre.
 *
 * Le titre stocke dans la file commence par « NC 5/2026 — ... ». On ne devine
 * rien : sans numero lisible, la note est ecartee et signalee, plutot que
 * rangee sous un numero invente.
 */
function numeroDuTexte(titre, type) {
  if (type === "NORME_COMPTABLE") {
    const m = /\bNCT?[ \t]*(\d{1,2})\b/i.exec(titre);
    return m ? String(Number(m[1])) : null;
  }
  const m =
    /\bNC[ \t]*(\d{1,3})\s*\/\s*(\d{4})/i.exec(titre) ??
    /note[ \t]+commune[^0-9]{0,20}(\d{1,3})/i.exec(titre);
  return m ? String(Number(m[1])) : null;
}

/**
 * L'identite qu'une note porte SUR ELLE-MEME : « NOTE COMMUNE N° 11/2009 ».
 *
 * Le portail de la DGELF indexe la meme note sous deux annees — sa page 2010
 * renvoyait aux PDF des notes de 2009 — et se trompe parfois de numero. La note
 * est la seule a savoir qui elle est : on la croit elle, pas son index.
 *
 * Reserve : la couche de texte de certains PDF rend les suites de chiffres a
 * l'envers (« N° 82/2012 » pour la note 28, « /3122 » pour 2011). Une lecture
 * impossible n'est pas une identite : on garde alors celle du portail, et on
 * cesse de promettre le verbatim sur un texte dont les chiffres sont douteux.
 */
const ANNEE_LA_PLUS_ANCIENNE = 1990;

function identiteDeLaNote(texte) {
  const m = /note\s+commune\s*n[^0-9]{0,4}(\d{1,3})\s*\/\s*(\d{4})/i.exec(texte.slice(0, 1500));
  if (!m) return null;
  return { numero: m[1], annee: Number(m[2]) };
}

function chiffresRetournes(entete, numeroDuPortail) {
  const maintenant = new Date().getFullYear();
  if (entete.annee < ANNEE_LA_PLUS_ANCIENNE || entete.annee > maintenant + 1) return true;
  const alEnvers = entete.numero.split("").reverse().join("");
  return entete.numero !== numeroDuPortail && alEnvers === numeroDuPortail;
}

/**
 * Millesime d'un texte qui n'en porte pas : le texte le plus recent qu'il cite.
 * Une norme ne peut pas etre anterieure a ce qu'elle vise. C'est une borne
 * inferieure, pas une date de publication.
 */
function anneeDeduite(texte) {
  const maintenant = new Date().getFullYear();
  let max = null;
  for (const m of texte.matchAll(/\b(19\d{2}|20\d{2})\b/g)) {
    const a = Number(m[1]);
    if (a <= maintenant && (max === null || a > max)) max = a;
  }
  return max;
}

/** Le corpus et l'autorite dependent du type de texte. */
const FAMILLES = {
  NOTE_COMMUNE: { corpus: (n) => `NC-${n.annee}`, source: "NOTE_COMMUNE" },
  // Chaque norme comptable est approuvee par arrete du ministre des finances.
  NORME_COMPTABLE: { corpus: () => "NCT", source: "ARRETE" },
};

async function texteDuPdf(chemin) {
  const cache = chemin.replace(/\.pdf$/i, ".txt");
  if (existsSync(cache)) return readFileSync(cache, "utf8");
  const tache = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(chemin)),
    disableFontFace: true,
    standardFontDataUrl: pathToFileURL(join(DEPOT, "node_modules/pdfjs-dist/standard_fonts/")).href,
  });
  const doc = await tache.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const contenu = await page.getTextContent();
    let ligne = "";
    let dernierY = null;
    const lignes = [];
    for (const item of contenu.items) {
      if (!("str" in item)) continue;
      const y = Math.round(item.transform[5]);
      if (dernierY !== null && Math.abs(y - dernierY) > 2) {
        lignes.push(ligne.trim());
        ligne = "";
      }
      ligne += item.str;
      if (item.hasEOL) {
        lignes.push(ligne.trim());
        ligne = "";
      }
      dernierY = y;
    }
    if (ligne.trim()) lignes.push(ligne.trim());
    pages.push(lignes.join("\n"));
  }
  await tache.destroy();
  const texte = pages.join("\n\n");
  writeFileSync(cache, texte, "utf8");
  return texte;
}

async function telecharger(url, destination) {
  if (existsSync(destination) && statSync(destination).size > 1000) return true;
  // Les URL de jibaya.tn portent des caracteres arabes : il faut les encoder.
  const adresse = /[^\x00-\x7F]/.test(url) ? encodeURI(url) : url;
  const r = await fetch(adresse, { headers: { "User-Agent": "Malica/1.0" } });
  if (!r.ok) return false;
  const octets = Buffer.from(await r.arrayBuffer());
  if (octets.length < 1000) return false;
  writeFileSync(destination, octets);
  return true;
}

/**
 * La publication officielle d'une note commune.
 *
 * Une note commune ne parait pas au Journal Officiel : elle parait au BULLETIN
 * OFFICIEL DES DOUANES ET DES IMPOTS, et porte en plus son numero de texte a la
 * Direction generale des impots. Les deux sont imprimes en tete de la note ; on
 * les releve tels quels. C'est la meme exigence que pour une loi : pouvoir
 * montrer ou le texte a paru, et non seulement le citer.
 */
function publicationDeLaNote(texte) {
  const tete = texte.slice(0, 1200);
  const bodi =
    /BULLETIN[ \t]+OFFICIEL[ \t]+DES[ \t]+DOUANES[ \t]+ET[ \t]+DES[ \t]+IMPOTS[ \t]*N[\u00b0\u00bao][ \t]*([\d\/.-]+)/i.exec(
      tete,
    );
  const dgi = /Texte[ \t]+n[\u00b0\u00bao][ \t]*((?:DGI|D\.G\.I)[ \t\d\/.-]+)/i.exec(tete);
  const bouts = [];
  if (bodi) bouts.push(`BODI n\u00b0 ${bodi[1].trim()}`);
  if (dgi) bouts.push(`texte n\u00b0 ${dgi[1].replace(/\s+/g, " ").trim()}`);
  return bouts.length ? bouts.join(", ") : null;
}

/**
 * D'ou vient le texte d'une note : `provenance-nc.json`, a cote de ce script,
 * liste celles qui ont ete recuperees par reconnaissance optique. Tout ce qui
 * n'y figure pas est extrait tel quel du PDF. Une note passee a l'OCR ne doit
 * jamais se faire passer pour le texte imprime.
 */
function provenances() {
  try {
    const v = JSON.parse(readFileSync(join(ICI, "provenance-nc.json"), "utf8"));
    const table = {};
    for (const [k, c] of Object.entries(v)) {
      if (k.startsWith("_")) continue;
      if (!["verbatim", "partiel", "incertain"].includes(c)) {
        throw new Error(`provenance inconnue pour ${k} : ${c}`);
      }
      table[k] = c;
    }
    return table;
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

/** Le texte doit ressembler a une note, pas a une page blanche numerisee. */
const TEXTE_MINIMUM = 400;

async function main() {
  const sec = process.argv.includes("--sec");
  const iL = process.argv.indexOf("--limite");
  const limite = iL >= 0 ? Number(process.argv[iL + 1]) : Infinity;
  // --seulement limite la passe aux textes dont le nom court correspond, par
  // exemple « ^NC-2018-(7|23)-fr$ ». Une passe ainsi limitee ne reecrit QUE les
  // notes qu'elle relit : sans cela, relire une note effacerait les six cents
  // autres de son millesime, faute de les avoir sous la main.
  const iS = process.argv.indexOf("--seulement");
  const seulement = iS >= 0 ? new RegExp(process.argv[iS + 1]) : null;

  const client = new pg.Client({ connectionString: API["DATABASE_URL_ADMIN"] });
  await client.connect();

  const { rows: notes } = await client.query(
    `select id, annee, langue, titre, url_fichier, type_document
       from legal.ingestion_queue
      where type_document in ('NOTE_COMMUNE', 'NORME_COMPTABLE') and url_fichier is not null
      order by type_document, annee nulls first, titre`,
  );
  console.log(`textes en file : ${notes.length}\n`);

  const dossier = join(ICI, "pdf-nc");
  mkdirSync(dossier, { recursive: true });
  const provenance = provenances();

  const retenues = [];
  const echecs = [];
  const redressees = [];
  const brouillees = [];

  // Le telechargement est le temps long : six a la fois, pas un par un. La
  // lecture des PDF reste sequentielle — pdf.js n'y gagnerait rien.
  const aFaire = [];
  for (const n of notes) {
    if (aFaire.length >= limite) break;
    const numero = numeroDuTexte(n.titre, n.type_document);
    if (!numero) {
      echecs.push([n.titre.slice(0, 60), "numero illisible"]);
      continue;
    }
    // Une note peut exister en francais et en arabe : la langue fait partie du
    // nom du fichier, pas de l'identite de la note.
    const langue = n.langue === "ar" ? "ar" : "fr";
    const prefixe = n.type_document === "NORME_COMPTABLE" ? "NCT" : `NC-${n.annee}`;
    const nom = `${prefixe}-${numero}-${langue}`;
    if (seulement && !seulement.test(nom)) continue;
    aFaire.push({ ...n, numero, langue, nom });
  }

  const PARALLELE = 6;
  let curseur = 0;
  let recus = 0;
  await Promise.all(
    Array.from({ length: PARALLELE }, async () => {
      while (curseur < aFaire.length) {
        const t = aFaire[curseur];
        curseur += 1;
        t.recu = await telecharger(t.url_fichier, join(dossier, `${t.nom}.pdf`));
        recus += 1;
        if (recus % 25 === 0) process.stdout.write(`  ${recus}/${aFaire.length} telecharges\r`);
      }
    }),
  );
  console.log(`  ${recus}/${aFaire.length} telecharges`);

  for (const n of aFaire) {
    const { numero, langue, nom } = n;
    const pdf = join(dossier, `${nom}.pdf`);
    if (!n.recu) {
      echecs.push([nom, "telechargement"]);
      continue;
    }
    let texte;
    try {
      texte = nettoyerTexte(await texteDuPdf(pdf));
    } catch (e) {
      echecs.push([nom, `extraction : ${e.message.slice(0, 40)}`]);
      continue;
    }
    if (texte.trim().length < TEXTE_MINIMUM) {
      echecs.push([nom, "PDF sans texte (numerise)"]);
      continue;
    }
    const famille = FAMILLES[n.type_document];
    let annee = n.annee ?? anneeDeduite(texte);
    let numeroRetenu = numero;
    let confiance = provenance[nom] ?? "verbatim";
    const entete = n.type_document === "NOTE_COMMUNE" ? identiteDeLaNote(texte) : null;
    if (entete && chiffresRetournes(entete, numero)) {
      if (confiance === "verbatim") confiance = "incertain";
      brouillees.push(`${nom} (en-tete lu : ${entete.numero}/${entete.annee})`);
    } else if (entete && (entete.numero !== numero || entete.annee !== annee)) {
      redressees.push(`${nom} -> NC-${entete.annee} n${Number(entete.numero)}`);
      numeroRetenu = String(Number(entete.numero));
      annee = entete.annee;
    }
    if (!annee) {
      echecs.push([nom, "millesime introuvable"]);
      continue;
    }
    retenues.push({
      corpus: famille.corpus({ ...n, annee }),
      source: famille.source,
      numero: numeroRetenu,
      // L'identite sous laquelle le portail rangeait ce texte. Une passe
      // limitee doit effacer l'ANCIENNE place autant que la nouvelle : sans
      // cela, une note redressee resterait aussi a son ancien numero.
      corpusInitial: famille.corpus(n),
      numeroInitial: numero,
      annee,
      langue,
      texte: texte.trim(),
      titre: n.titre,
      url: n.url_fichier,
      sha: createHash("sha256").update(texte.trim(), "utf8").digest("hex"),
      // Le Bulletin officiel des douanes et des impots ne concerne que les
      // notes communes ; une norme comptable ne s'y publie pas.
      publication: n.type_document === "NOTE_COMMUNE" ? publicationDeLaNote(texte) : null,
      confiance,
      queueId: n.id,
    });
    if (retenues.length % 25 === 0) process.stdout.write(`  ${retenues.length} notes lues\r`);
  }

  console.log(`\ntextes exploitables : ${retenues.length}`);
  if (redressees.length) {
    console.log(
      `identites redressees sur l'en-tete (${redressees.length}) : ${redressees.join(", ")}`,
    );
  }
  if (brouillees.length) {
    console.log(
      `chiffres brouilles par le PDF (${brouillees.length}), passees en « incertain » : ${brouillees.join(", ")}`,
    );
  }
  if (echecs.length) {
    const motifs = new Map();
    for (const [, m] of echecs) motifs.set(m, (motifs.get(m) ?? 0) + 1);
    console.log(
      `ecartees (${echecs.length}) : ${[...motifs].map(([m, c]) => `${m} x${c}`).join(", ")}`,
    );
  }
  if (sec) {
    await client.end();
    return;
  }

  await client.query("begin");
  // On ne touche qu'aux notes communes.
  // On ne touche qu'aux corpus que ce script produit.
  //
  // Une passe COMPLETE remplace ses corpus entiers : une note disparue du
  // portail doit disparaitre de la base. Une passe LIMITEE ne remplace que les
  // identites qu'elle a relues — elle repare, elle ne fait pas le vide.
  if (seulement) {
    const places = new Map();
    for (const r of retenues) {
      places.set(`${r.corpus}\u0000${r.numero}`, [r.corpus, r.numero]);
      places.set(`${r.corpusInitial}\u0000${r.numeroInitial}`, [r.corpusInitial, r.numeroInitial]);
    }
    const corpus = [...places.values()].map((p) => p[0]);
    const numeros = [...places.values()].map((p) => p[1]);
    await client.query(
      `delete from legal.article_versions v using legal.articles a
        where a.id = v.article_id
          and (a.corpus, a.numero) in (select * from unnest($1::text[], $2::text[]))`,
      [corpus, numeros],
    );
    await client.query(
      `delete from legal.articles
        where (corpus, numero) in (select * from unnest($1::text[], $2::text[]))`,
      [corpus, numeros],
    );
  } else {
    const corpusGeres = [...new Set(retenues.map((r) => r.corpus))];
    await client.query(
      `delete from legal.article_versions v using legal.articles a
        where a.id = v.article_id and a.corpus = any($1)`,
      [corpusGeres],
    );
    await client.query(`delete from legal.articles where corpus = any($1)`, [corpusGeres]);
  }

  let ecrites = 0;
  const versionsParNote = new Map();
  for (const r of retenues) {
    const cle = `${r.corpus}\u0000${r.numero}`;
    const liste = versionsParNote.get(cle) ?? [];
    liste.push(r);
    versionsParNote.set(cle, liste);
  }

  for (const [cle, liste0] of versionsParNote) {
    let liste = liste0;
    const [corpus, numero] = cle.split("\u0000");
    const { rows } = await client.query(
      `insert into legal.articles (jurisdiction, corpus, numero, source_code, statut)
       values ('TN', $1, $2, $3, 'indetermine')
       on conflict (jurisdiction, corpus, numero)
         do update set source_code = excluded.source_code
       returning id`,
      [corpus, numero, liste[0].source],
    );
    const articleId = rows[0].id;
    // Le francais et l'arabe d'une meme note sont deux versions du meme texte.
    // Mais une meme note publiee deux fois sur le portail, sous deux adresses,
    // porte le meme texte : c'est une seule version, pas deux. On les distingue
    // par l'empreinte du texte, pas par l'adresse d'ou il vient.
    const vues = new Set();
    const distinctes = liste.filter((v) => {
      if (vues.has(v.sha)) return false;
      vues.add(v.sha);
      return true;
    });
    liste = distinctes;
    liste.sort((a, b) => a.langue.localeCompare(b.langue));
    for (let i = 0; i < liste.length; i += 1) {
      const v = liste[i];
      await client.query(
        `insert into legal.article_versions
           (article_id, version_num, texte_fr, texte_ar, langue_faisant_foi, source_sha256,
            source_url, valid_from, valid_to, extraction_confiance, edition_min, edition_max,
            jort_reference)
         values ($1, $2, $3, $4, $5, $6, $7, make_date($8,1,1), null, $10, $8, $8, $9)`,
        [
          articleId,
          i + 1,
          v.langue === "ar" ? null : v.texte,
          v.langue === "ar" ? v.texte : null,
          v.langue,
          v.sha,
          v.url,
          v.annee,
          v.publication,
          v.confiance,
        ],
      );
      ecrites += 1;
    }
  }

  await client.query(
    `update legal.ingestion_queue set statut = 'ingere', ingere_le = now()
      where id = any($1)`,
    [retenues.map((r) => r.queueId)],
  );
  await client.query("commit");
  console.log(`textes ecrits      : ${versionsParNote.size} identites, ${ecrites} versions`);
  await client.end();
}

main().catch((e) => {
  console.error("echec :", e);
  process.exit(1);
});
