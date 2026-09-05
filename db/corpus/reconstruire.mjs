/**
 * Reconstruction du corpus juridique : PDF -> texte -> articles -> versions.
 *
 * Remplace le decoupage livre par l'archive, dont la regle « garder l'occurrence
 * la plus longue » attribuait a l'article 7 du code de la TVA la page de
 * signatures d'un decret annexe.
 *
 *   bun reconstruire.mjs [--sec] [--corpus CTVA] [--langue ar]
 *
 * --sec : ne touche pas la base, se contente du rapport.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { decouper, enChiffresOccidentaux } from "./segmenter.mjs";
import { retirerEntetesDePage } from "./entetes.mjs";

/**
 * Ce que porte l'entete de page du Journal Officiel.
 *
 * « N° 148 Journal Officiel de la Republique Tunisienne — 12 decembre 2025
 * Page 3343 ». Trois informations : le numero du journal, sa date, et la page.
 * Elles sont la preuve de la publication officielle — sans elles, Regalica cite
 * un article sans pouvoir montrer ou il a paru, ce qui ne tient pas devant un
 * controle. On les releve AVANT de retirer les entetes du texte.
 *
 * Les editions consolidees de la DGELF n'en portent pas : ce ne sont pas des
 * numeros du Journal Officiel mais des compilations administratives. Elles
 * restent donc sans reference, et c'est exact.
 */
const RE_ENTETE_JORT =
  /^[ \t]*([^\n]{0,40}?)Journal[ \t]+Officiel[ \t]+de[ \t]+la[ \t]+R[\u00e9e]publique[ \t]+Tunisienne([^\n]{0,80})$/gim;
const MOIS_FR = ["janvier","f\u00e9vrier","mars","avril","mai","juin","juillet","ao\u00fbt","septembre","octobre","novembre","d\u00e9cembre"];
const RE_DATE_JORT = new RegExp("(\\d{1,2})(?:\\s*[-\u2013]\\s*\\d{1,2})?\\s+(" + MOIS_FR.join("|") + ")\\s+(\\d{4})", "i");

function releverJort(texte) {
  const pages = [];
  const numeros = new Map();
  const dates = new Map();
  for (const m of texte.matchAll(RE_ENTETE_JORT)) {
    const bords = `${m[1]} ${m[2]}`;
    const n = /N[\u00b0\u00bao][ \t]*(\d{1,4})/i.exec(bords);
    if (n) numeros.set(n[1], (numeros.get(n[1]) ?? 0) + 1);
    const d = RE_DATE_JORT.exec(bords);
    if (d) {
      const cle = `${Number(d[1])} ${d[2].toLowerCase()} ${d[3]}`;
      dates.set(cle, (dates.get(cle) ?? 0) + 1);
    }
    const p = /Page[ \t]*(\d{1,5})/i.exec(bords) ?? /^[ \t]*(\d{2,5})[ \t]*$/.exec(m[1]);
    if (p) pages.push({ pos: m.index, page: Number(p[1]) });
  }
  const majoritaire = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const numero = majoritaire(numeros);
  const date = majoritaire(dates);
  if (!numero && !date) return null;
  const tete = ["JORT", numero ? `n\u00b0 ${numero}` : null, date ? `du ${date}` : null]
    .filter(Boolean).join(" ");
  pages.sort((a, b) => a.pos - b.pos);
  return { tete, pages };
}

/** La page sur laquelle commence un article : celle de l'entete qui le precede. */
function pageDe(jort, position) {
  if (!jort || jort.pages.length === 0) return null;
  let page = null;
  for (const p of jort.pages) {
    if (p.pos > position) break;
    page = p.page;
  }
  return page;
}

/**
 * Un article abroge le dit lui-meme, entre parentheses, des sa premiere ligne :
 * « ARTICLE 21 (Abroge par l'article 7 de la loi n\u00b02000-82 du 9 aout 2000) ».
 * On releve la mention VERBATIM ; on n'en deduit rien qu'elle ne dise.
 */
const RE_ABROGATION = /\((\s*(?:Abrog|abrog|ABROG|\u0623\u0644\u063a|\u0645\u0644\u063a)[^)]{0,240})\)/;

function abrogation(texte) {
  const m = RE_ABROGATION.exec(texte.slice(0, 400));
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/**
 * De quel type de texte releve un corpus — donc quelle autorite il a, et a qui
 * il est opposable. Les codes sont annexes a une loi de promulgation ; les lois
 * de finances sont des lois ordinaires ; quatre d'entre elles ont ete prises par
 * decret-loi. Le recueil, lui, compile des textes de natures differentes : la
 * nature y est relevee texte par texte, a la lecture de son titre.
 */
/**
 * Millesime d'une edition qui n'en porte pas.
 *
 * Le code de la comptabilite publique est publie sans date d'edition. Sans
 * millesime, ses 305 articles etaient ecartes en silence a l'ecriture — une
 * perte que rien n'annoncait. On date donc l'edition par le texte le plus
 * recent qu'elle cite : une compilation ne peut pas etre anterieure a ce
 * qu'elle contient. C'est une borne INFERIEURE, et elle est dite comme telle
 * dans la documentation ; ce n'est pas la date de publication.
 */
function anneeDeduite(texteBrut) {
  // Une edition arabe ecrit ses annees en chiffres arabo-indiens : la
  // convention avec l'Arabie saoudite porte « ١٩٩٤ » et pas « 1994 ». Sans
  // cette conversion, trois conventions entieres etaient ecartees pour
  // « millesime introuvable » alors que leur date etait sous nos yeux.
  const texte = enChiffresOccidentaux(texteBrut);
  const maintenant = new Date().getFullYear();
  let max = null;
  const retenir = (a) => { if (a <= maintenant && (max === null || a > max)) max = a; };
  for (const m of texte.matchAll(/\b(19\d{2}|20\d{2})\b/g)) retenir(Number(m[1]));
  // Certains textes ne datent qu'en chiffres a deux positions : la convention
  // avec l'Egypte porte « 08/12/89 » et pas une seule annee a quatre chiffres.
  // Sans cette lecture, l'edition entiere disparaissait a l'ecriture, en silence.
  if (max === null) {
    for (const m of texte.matchAll(/\b\d{1,2}\/\d{1,2}\/(\d{2})\b/g)) {
      const d = Number(m[1]);
      retenir(d > maintenant % 100 ? 1900 + d : 2000 + d);
    }
  }
  return max;
}

function sourceDuCorpus(typeDocument, corpus) {
  if (typeDocument === "NOTE_COMMUNE") return "NOTE_COMMUNE";
  // Une convention ratifiee prime sur la loi interne : Constitution 2022,
  // article 74. C'est la ligne la plus haute de legal.sources.
  if (typeDocument === "CONVENTION") return "CONVENTION";
  if (typeDocument === "LOI_FINANCES") {
    return corpus.startsWith("DECRET_LOI_FINANCES") ? "DECRET_LOI" : "LF";
  }
  return "LOI";
}

const ICI = dirname(fileURLToPath(import.meta.url));
const DEPOT = "C:/Users/wisse/OneDrive/Bureau/ALGORIA Factory/Platefomre/Regalica Office/regalica-office";
const { default: pg } = await import(pathToFileURL(join(DEPOT, "node_modules/pg/lib/index.js")).href);
const pdfjs = await import(pathToFileURL(join(DEPOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);

// Les recueils ne sont pas des codes : ils compilent des textes separes.
const COMPILATIONS = new Set(["RECUEIL"]);

/**
 * D'ou vient le texte d'une edition, et donc ce qu'il vaut.
 *
 *   verbatim  — texte extrait tel quel du PDF ;
 *   partiel   — PDF a police maison, dechiffre par substitution : les lettres
 *               sont sures, quelques signes (apostrophes) sont perdus ;
 *   incertain — reconnaissance optique d'un microfilm : lisible, pas fiable au
 *               caractere pres.
 *
 * Le fichier provenance.json, a cote de ce script, porte les exceptions ; tout
 * ce qui n'y figure pas est du verbatim. Cette valeur part en base et s'affiche : un texte issu
 * de l'OCR ne doit jamais se faire passer pour le Journal Officiel.
 */
const CONFIANCES = ["verbatim", "partiel", "incertain"];
function provenances(dossier) {
  try {
    const v = JSON.parse(readFileSync(join(dossier, "provenance.json"), "utf8"));
    const table = {};
    for (const [k, c] of Object.entries(v)) {
      if (k.startsWith("_")) continue; // les clefs de commentaire
      if (!CONFIANCES.includes(c)) throw new Error(`provenance inconnue pour ${k} : ${c}`);
      table[k] = c;
    }
    return table;
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

function env(fichier) {
  const v = {};
  try {
    for (const l of readFileSync(join(DEPOT, fichier), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
      if (m) v[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* le .env manquant leve plus bas */ }
  return v;
}
const API = env("apps/api/.env");

/**
 * PostgreSQL refuse l'octet nul et les demi-paires de substitution dans une
 * colonne text. Les extractions de PDF en produisent : polices mal encodees,
 * glyphes sans correspondance Unicode. On les retire ici plutot que de laisser
 * une edition entiere echouer a l'ecriture.
 */
function nettoyerTexte(t) {
  return t
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}


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
      if (dernierY !== null && Math.abs(y - dernierY) > 2) { lignes.push(ligne.trim()); ligne = ""; }
      ligne += item.str;
      if (item.hasEOL) { lignes.push(ligne.trim()); ligne = ""; }
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
  if (existsSync(destination)) return true;
  // Plusieurs sites refusent une requete sans navigateur declare : sans
  // User-Agent, droit-afrique.com rend une erreur et l'edition entiere se
  // perdait sur un « TELECHARGEMENT ECHOUE » sans cause visible.
  const adresse = /[^\x00-\x7F]/.test(url) ? encodeURI(url) : url;
  let r;
  try {
    r = await fetch(adresse, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Regalica/1.0",
        Accept: "application/pdf,*/*",
      },
      redirect: "follow",
    });
  } catch (e) {
    process.stdout.write(`(${e.message.slice(0, 40)}) `);
    return false;
  }
  if (!r.ok) { process.stdout.write(`(HTTP ${r.status}) `); return false; }
  const octets = Buffer.from(await r.arrayBuffer());
  if (octets.length < 1000) { process.stdout.write("(fichier vide) "); return false; }
  writeFileSync(destination, octets);
  return true;
}

async function main() {
  const sec = process.argv.includes("--sec");
  const iC = process.argv.indexOf("--corpus");
  const filtre = iC >= 0 ? process.argv[iC + 1] : null;
  // --langue restreint la passe a une langue. Une edition arabe et une edition
  // francaise d'un meme corpus portent LE MEME article sous deux redactions :
  // reconstruire l'une ne doit pas effacer l'autre.
  const iL = process.argv.indexOf("--langue");
  const langue = iL >= 0 ? process.argv[iL + 1] : null;

  const client = new pg.Client({ connectionString: API["DATABASE_URL_ADMIN"] });
  await client.connect();

  const { rows: docs } = await client.query(
    // Les codes, les lois de finances et les conventions internationales — tous
    // des textes a articles. Les notes communes n'en sont pas : elles ne se
    // decoupent pas, et notes.mjs les traite a part.
    `select id, corpus, annee, langue, url_fichier, pages, type_document
       from legal.ingestion_queue
      where type_document in ('CODE_CONSOLIDE', 'LOI_FINANCES', 'CONVENTION') and url_fichier is not null
        and ($1::text is null or corpus = $1)
        and ($2::text is null or langue = $2)
      order by type_document, corpus, annee nulls first`,
    [filtre, langue],
  );
  console.log(`editions a traiter : ${docs.length}\n`);

  const dossier = join(ICI, "pdf");
  mkdirSync(dossier, { recursive: true });
  const provenance = provenances(ICI);

  // (corpus, numero, edition) -> { texte, sha, langue }
  const extraits = [];
  const echecs = [];

  for (const d of docs) {
    const nom = `${d.corpus}-${d.annee ?? "sans-millesime"}-${d.langue}`;
    const pdf = join(dossier, `${nom}.pdf`);
    process.stdout.write(`${nom.padEnd(28)} `);
    if (!(await telecharger(d.url_fichier, pdf))) {
      console.log("TELECHARGEMENT ECHOUE");
      echecs.push([nom, "telechargement", d.id]);
      continue;
    }
    let brut;
    try {
      brut = await texteDuPdf(pdf);
    } catch (e) {
      console.log(`EXTRACTION ECHOUEE : ${e.message.slice(0, 60)}`);
      echecs.push([nom, "extraction", d.id]);
      continue;
    }
    // On LIT l'entete de page avant de la retirer : elle porte la reference au
    // Journal Officiel. Ensuite seulement on la retire du texte, ou elle se
    // repete des centaines de fois au milieu des articles et se ferait encoder
    // comme du droit. Le retrait conserve les positions : le decoupage en
    // depend, et la pagination relevee ci-dessus aussi.
    const jort = releverJort(brut);
    const texte = retirerEntetesDePage(brut);
    const annee = d.annee ?? anneeDeduite(texte);
    if (annee == null) {
      console.log("MILLESIME INTROUVABLE — edition laissee de cote");
      echecs.push([nom, "millesime introuvable", d.id]);
      continue;
    }
    const articles = decouper(texte, d.langue, { compilation: COMPILATIONS.has(d.corpus) });
    if (articles.length < 5) {
      console.log(`DECOUPAGE NON FIABLE (${articles.length} articles) — edition laissee de cote`);
      echecs.push([nom, "decoupage", d.id]);
      continue;
    }
    for (const a of articles) {
      // PostgreSQL refuse l'octet nul et les demi-paires de substitution dans
      // une colonne text. Les extractions de PDF en produisent : polices mal
      // encodees, glyphes sans correspondance Unicode. On les retire ici plutot
      // que de laisser une edition entiere echouer a l'ecriture.
      const propre = nettoyerTexte(a.texte);
      extraits.push({
        // Pour un CODE, l'article 52 traverse les editions : une identite, des
        // versions. Pour une LOI DE FINANCES, chaque loi est un texte distinct —
        // l'article 10 de la LF 1995 n'a rien a voir avec celui de la LF 2026.
        docId: d.id,
        // L'adresse d'ou le texte vient. Sans elle, une version cite son
        // article et sa page au Journal Officiel, mais ne dit pas quel fichier
        // a ete lu : la piece justificative manque au dossier.
        url: d.url_fichier,
        corpus: d.type_document === "LOI_FINANCES" ? `${d.corpus}-${d.annee}` : d.corpus,
        numero: a.numero,
        edition: annee,
        langue: d.langue,
        texte: propre,
        confiance: provenance[nom] ?? "verbatim",
        // La nature du texte se lit sur son titre dans un recueil ; ailleurs
        // elle vaut pour tout le corpus.
        source: a.source ?? sourceDuCorpus(d.type_document, d.corpus),
        jort: jort ? [jort.tete, pageDe(jort, a.debut) ? `p. ${pageDe(jort, a.debut)}` : null].filter(Boolean).join(", ") : null,
        sha: createHash("sha256").update(propre, "utf8").digest("hex"),
      });
    }
    const moy = Math.round(articles.reduce((s, a) => s + a.texte.length, 0) / articles.length);
    if (d.annee == null) console.log(`(millesime absent : date deduite ${annee})`);
    console.log(
      `${String(articles.length).padStart(4)} articles, n° ${articles[0].numero} -> ${articles[articles.length - 1].numero}, moyenne ${moy} car.`,
    );
  }

  // Une edition qui rend beaucoup moins d'articles que la meilleure edition du
  // meme corpus n'a pas ete correctement decoupee. La laisser passer serait
  // pire que l'ecarter : comme elle est souvent la plus recente, elle
  // deviendrait « la derniere version » de chaque article qu'elle contient, et
  // masquerait un texte complet derriere un fragment.
  const parEdition = new Map();
  for (const e of extraits) {
    const cle = `${e.corpus} ${e.edition}`;
    parEdition.set(cle, (parEdition.get(cle) ?? 0) + 1);
  }
  const maxParCorpus = new Map();
  for (const [cle, n] of parEdition) {
    const corpus = cle.split(" ")[0];
    if (n > (maxParCorpus.get(corpus) ?? 0)) maxParCorpus.set(corpus, n);
  }
  const SEUIL = 0.6;
  const rejetees = new Set();
  for (const [cle, n] of parEdition) {
    const corpus = cle.split(" ")[0];
    if (n < SEUIL * maxParCorpus.get(corpus)) rejetees.add(cle);
  }
  if (rejetees.size) {
    console.log(
      `\neditions trop pauvres, ecartees (${rejetees.size}) : ` +
        [...rejetees].map((c) => c.replace(" ", " ") + ` (${parEdition.get(c)} articles)`).join(", "),
    );
    for (let i = extraits.length - 1; i >= 0; i -= 1) {
      if (rejetees.has(`${extraits[i].corpus} ${extraits[i].edition}`)) extraits.splice(i, 1);
    }
  }

  console.log(`\ntotal : ${extraits.length} occurrences d'articles`);
  if (echecs.length) {
    console.log(`editions ecartees (${echecs.length}) : ${echecs.map(([n, r]) => `${n} (${r})`).join(", ")}`);
  }
  if (sec) { await client.end(); return; }

  // ---------------------------------------------------------------- ecriture
  //
  // Une IDENTITE par (corpus, numero). Une VERSION par empreinte distincte,
  // bornee par les editions ou elle apparait. Deux editions qui portent le meme
  // SHA-256 sont la meme version : c'est de l'arithmetique, pas une lecture.
  const derniereEdition = new Map();
  for (const e of extraits) {
    if (e.edition == null) continue;
    const v = derniereEdition.get(e.corpus) ?? 0;
    if (e.edition > v) derniereEdition.set(e.corpus, e.edition);
  }

  const parCle = new Map(); // corpus|numero|sha -> { editions[], texte, langue }
  for (const e of extraits) {
    if (e.edition == null) continue;
    const cle = `${e.corpus}\u0000${e.numero}\u0000${e.sha}`;
    const v = parCle.get(cle) ?? { corpus: e.corpus, numero: e.numero, sha: e.sha, editions: [], adresses: new Map(), texte: e.texte, langue: e.langue, confiance: e.confiance, source: e.source, jort: e.jort };
    // Une version peut venir de plusieurs editions : on retient l'adresse de la
    // PLUS ANCIENNE, celle ou ce texte apparait pour la premiere fois.
    if (e.url) v.adresses.set(e.edition, e.url);
    // Une meme version peut venir de plusieurs editions : elle ne vaut pas mieux
    // que la moins sure d'entre elles.
    if (CONFIANCES.indexOf(e.confiance) > CONFIANCES.indexOf(v.confiance)) v.confiance = e.confiance;
    v.editions.push(e.edition);
    parCle.set(cle, v);
  }

  // On ne vide QUE ce que ce script reconstruit. Les notes communes, ingerees
  // par notes.mjs, vivent dans les memes tables : un truncate les emportait.
  //
  // On ne remplace que les corpus REELLEMENT RELUS. Une edition que la passe
  // n'a pas su lire — PDF numerise, police sans table de correspondance — ne
  // doit pas emporter ce qu'une passe precedente en avait tire : la loi de
  // finances 2004 en arabe, lue jadis par reconnaissance optique, a disparu une
  // fois parce que le corpus etait vide sur la seule foi de la file.
  const corpusGeres = [...new Set(extraits.map((e) => e.corpus))];

  await client.query("begin");
  // Sans --langue, le corpus est remplace en entier : une edition disparue de la
  // source doit disparaitre de la base. Avec --langue, on ne retire que les
  // redactions de CETTE langue, puis les identites qui n'ont plus aucune
  // version — l'autre langue reste intacte.
  await client.query(
    `delete from legal.article_versions v using legal.articles a
      where a.id = v.article_id and a.corpus = any($1)
        and ($2::text is null or v.langue_faisant_foi = $2)`,
    [corpusGeres, langue],
  );
  await client.query(
    `delete from legal.articles a
      where a.corpus = any($1)
        and not exists (select 1 from legal.article_versions v where v.article_id = a.id)`,
    [corpusGeres],
  );

  const identites = new Map();
  for (const v of parCle.values()) {
    const cle = `${v.corpus}\u0000${v.numero}`;
    if (identites.has(cle)) continue;
    const { rows } = await client.query(
      `insert into legal.articles (jurisdiction, corpus, numero, source_code) values ('TN', $1, $2, $3)
       on conflict (jurisdiction, corpus, numero) do update set source_code = excluded.source_code
       returning id`,
      [v.corpus, v.numero, v.source ?? null],
    );
    identites.set(cle, rows[0].id);
  }
  console.log(`identites d'articles : ${identites.size}`);

  // Les versions d'un article, ordonnees par edition d'apparition.
  const parArticle = new Map();
  for (const v of parCle.values()) {
    const cle = `${v.corpus}\u0000${v.numero}`;
    const liste = parArticle.get(cle) ?? [];
    liste.push(v);
    parArticle.set(cle, liste);
  }

  let versions = 0;
  for (const [cle, liste] of parArticle) {
    liste.sort((a, b) => Math.min(...a.editions) - Math.min(...b.editions));
    for (let i = 0; i < liste.length; i += 1) {
      const v = liste[i];
      const eMin = Math.min(...v.editions);
      const eMax = Math.max(...v.editions);
      const finCorpus = derniereEdition.get(v.corpus) ?? eMax;
      await client.query(
        `insert into legal.article_versions
           (article_id, version_num, texte_fr, texte_ar, langue_faisant_foi, source_sha256,
            valid_from, valid_to, extraction_confiance, edition_min, edition_max, jort_reference,
            source_url)
         values ($1,
                 -- Le rang se prend DANS LA BASE, pas dans la passe : une passe
                 -- limitee a une langue ajoute ses redactions a cote de celles
                 -- de l'autre, elle ne recommence pas a 1 par-dessus.
                 (select coalesce(max(version_num), 0) + 1
                    from legal.article_versions where article_id = $1),
                 $2, $3, $4, $5, make_date($6,1,1), $7, $9, $6, $8, $10, $11)`,
        [
          identites.get(cle),
          v.langue === "ar" ? null : v.texte,
          v.langue === "ar" ? v.texte : null,
          // La langue qui fait foi est celle du texte que l'on DETIENT. Le
          // script d'origine ecrivait 'ar' en dur : 4 519 versions declaraient
          // l'arabe faisant foi sans porter une lettre d'arabe.
          v.langue,
          v.sha,
          eMin,
          eMax < finCorpus ? new Date(Date.UTC(eMax + 1, 0, 1)) : null,
          eMax,
          v.confiance,
          v.jort ?? null,
          v.adresses?.get(eMin) ?? null,
        ],
      );
      versions += 1;
    }
  }
  // ------------------------------------------------------- statut des articles
  //
  // Un article abroge le dit dans sa derniere redaction, et il le dit par qui.
  // Un article present dans une edition CONSOLIDEE et non marque comme abroge
  // est en vigueur : c'est ce que « consolide » veut dire. Ailleurs — dans une
  // loi de finances de 1986 — nous n'en savons rien, et nous le disons.
  const consolides = new Set(
    (await client.query(
      `select distinct corpus from legal.ingestion_queue where type_document = 'CODE_CONSOLIDE'`,
    )).rows.map((r) => r.corpus),
  );
  let abroges = 0;
  let enVigueur = 0;
  for (const [cle, liste] of parArticle) {
    // La derniere edition detenue, toutes langues confondues : un article
    // bilingue porte sa mention d'abrogation dans l'une ou l'autre.
    const derniereEd = Math.max(...liste.map((v) => Math.max(...v.editions)));
    const recentes = liste.filter((v) => Math.max(...v.editions) === derniereEd);
    const derniere = recentes[recentes.length - 1];
    const mention = recentes.map((v) => abrogation(v.texte)).find(Boolean) ?? null;
    let statut = "indetermine";
    if (mention) { statut = "abroge"; abroges += 1; }
    else if (consolides.has(derniere.corpus)) { statut = "en_vigueur"; enVigueur += 1; }
    await client.query(
      `update legal.articles set statut = $2, abroge_par = $3 where id = $1`,
      [identites.get(cle), statut, mention],
    );
  }

  // La file doit dire la verite : ce qui a produit des articles est ingere, ce
  // qui a echoue porte son motif. Sans cela, elle affiche encore « a faire »
  // pour des textes entres depuis longtemps, et personne ne sait plus ou on en est.
  const reussis = [...new Set(extraits.map((e) => e.docId).filter(Boolean))];
  const rates = echecs.filter(([, , id]) => id);
  await client.query(
    `update legal.ingestion_queue
        set statut = 'ingere', ingere_le = now(), echec_motif = null
      where id = any($1)`,
    [reussis],
  );
  //
  // Une edition que CETTE passe n'a pas su lire n'est pas forcement absente de
  // la base : la loi de finances 2004 en arabe y est, lue par reconnaissance
  // optique. « Echec » ne se dit que d'un document dont il ne reste RIEN.
  let rendus = 0;
  for (const [, motif, id] of rates) {
    const { rows } = await client.query(
      `select exists (
         select 1 from legal.article_versions v
          where v.source_url = (select url_fichier from legal.ingestion_queue where id = $1)
       ) as tient`,
      [id],
    );
    if (rows[0].tient) {
      await client.query(
        `update legal.ingestion_queue
            set statut = 'ingere',
                echec_motif = $2
          where id = $1`,
        [id, `relecture impossible (${motif}) — le texte en base vient d'une passe anterieure`],
      );
      rendus += 1;
      continue;
    }
    await client.query(
      `update legal.ingestion_queue set statut = 'echec', echec_motif = $2 where id = $1`,
      [id, motif],
    );
  }

  await client.query("commit");
  console.log(`versions ecrites     : ${versions}`);
  console.log(`file mise a jour     : ${reussis.length} ingeres, ${rates.length - rendus} en echec` +
    (rendus ? `, ${rendus} conservees d'une passe anterieure` : ""));
  console.log(`statuts              : ${enVigueur} en vigueur, ${abroges} abroges, ${identites.size - enVigueur - abroges} indetermines`);
  await client.end();
}

main().catch((e) => {
  console.error("echec :", e);
  process.exit(1);
});
