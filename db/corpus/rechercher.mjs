/**
 * Recherche semantique dans le corpus juridique.
 *
 * La question est encodee avec LE MEME modele que les fragments — celui que
 * `agents.model_pricing` designe pour le role « embedding ». Encoder la question
 * avec un autre modele que le corpus ne donne pas un resultat degrade : il donne
 * un resultat qui n'a aucun sens, dans un espace vectoriel different.
 *
 * Chaque resultat pointe vers un fragment, donc vers une version d'article,
 * donc vers un texte que l'on peut relire. Rien n'est resume, rien n'est genere.
 *
 *   bun db/corpus/rechercher.mjs "taux de TVA applicable aux services" [--nb 20]
 *   bun db/corpus/rechercher.mjs "taux de TVA" --au 2024-12-31
 *
 * --au : l'etat du droit A CETTE DATE, et non le dernier. Un controle fiscal
 * porte sur un exercice clos : la regle qui s'y applique est celle qui etait en
 * vigueur cette annee-la, pas celle d'aujourd'hui. Sans date, on rend le
 * dernier etat — c'est ce que demande une question posee au present.
 *
 * Ce que --au sait et ne sait pas. Les bornes de validite viennent des EDITIONS
 * que l'on detient : un texte identique dans l'edition 2018 et dans celle de
 * 2020, puis different en 2022, vaut « du 1er janvier 2018 au 1er janvier
 * 2021 ». La date de la modification reelle, elle, est dans la loi de finances
 * qui l'a operee. La reponse est donc juste a l'edition pres, jamais au jour
 * pres, et le resultat affiche toujours ses bornes pour qu'on puisse le voir.
 *
 * BUN, PAS NODE : voir l'en-tete de vectoriser.mjs (resolution IPv6 seule).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const DEPOT = join(ICI, "..", "..");
const { default: pg } = await import(
  pathToFileURL(join(DEPOT, "node_modules/pg/lib/index.js")).href
);
import { encoder, modeleEnVigueur } from "./empreintes.mjs";

function env(fichier) {
  const valeurs = {};
  try {
    for (const ligne of readFileSync(join(DEPOT, fichier), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(ligne);
      if (m) valeurs[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* absent : les variables exigees leveront plus bas */
  }
  return valeurs;
}
const API = env("apps/api/.env");
const WEB = env("apps/web/.env");

/** Accepte AAAA-MM-JJ et JJ/MM/AAAA ; refuse le reste plutot que de l'interpreter. */
function normaliserDate(v) {
  if (!v) throw new Error("--au attend une date");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) {
    const j = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (j) m = [null, j[3], j[2].padStart(2, "0"), j[1].padStart(2, "0")];
  }
  if (!m) throw new Error(`date illisible : ${v} (attendu AAAA-MM-JJ ou JJ/MM/AAAA)`);
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (Number.isNaN(Date.parse(iso))) throw new Error(`date inexistante : ${v}`);
  return iso;
}

async function main() {
  const args = process.argv.slice(2);
  // Vingt, pas cinq. Anthropic l'a mesure, et le raisonnement fiscal l'exige
  // par construction : l'exoneration, le seuil, le tableau annexe et la
  // convention sont dans d'AUTRES articles que celui qui porte la regle. Un
  // top-5 rend l'etape « cherche l'exception avant de conclure » impossible.
  let nb = 20;
  let historique = false;
  let doctrine = false;
  let jour = null;
  const mots = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--nb") {
      nb = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (args[i] === "--historique") {
      historique = true;
      continue;
    }
    // La doctrine administrative n'est pas de l'histoire : c'est ce que le fisc
    // dit aujourd'hui du texte en vigueur. Elle a donc son propre commutateur.
    if (args[i] === "--doctrine") {
      doctrine = true;
      continue;
    }
    if (args[i] === "--au") {
      jour = normaliserDate(args[i + 1]);
      i += 1;
      // Une date passee interroge l'historique : le droit d'alors se lit dans
      // les lois de finances de l'epoque autant que dans le code d'aujourd'hui.
      historique = true;
      continue;
    }
    mots.push(args[i]);
  }
  const question = mots.join(" ").trim();
  if (!question) {
    throw new Error(
      'usage: bun db/corpus/rechercher.mjs "votre question" [--nb 20] [--au AAAA-MM-JJ] [--historique] [--doctrine]',
    );
  }

  const client = new pg.Client({ connectionString: API["DATABASE_URL_ADMIN"] });
  await client.connect();

  const { model: modele } = await modeleEnVigueur(client);
  // La question s'encode cote « query », le corpus cote « document ». Voir
  // db/corpus/empreintes.mjs : sur un couple question/article reel, le cosinus
  // passe de 0,5755 a 0,6507 rien qu'en le disant au modele.
  const { vecteurs } = await encoder([question], "query", {
    base: WEB["QWEN_BASE_URL"],
    cle: WEB["QWEN_API_KEY"],
    modele,
  });
  const vecteur = vecteurs[0];

  // ------------------------------------------------------ la recherche hybride
  //
  // Trois temps, dans cet ordre, et l'ordre est le fond du sujet :
  //
  //   1. ON FILTRE — la derniere version de chaque langue, le perimetre demande
  //      (code en vigueur, doctrine, historique), la date. La pertinence
  //      juridique n'est pas la similarite textuelle : un article abroge
  //      ressemble mot pour mot a celui qui l'a remplace, un regime derogatoire
  //      ressemble au droit commun. Aucun modele ne les distingue ; le SQL, si.
  //   2. ON CLASSE DEUX FOIS — par le sens (vecteurs) et par les mots (index
  //      lexical) — sur ce perimetre-la, jamais sur toute la base.
  //   3. ON FUSIONNE par rang reciproque : 1/(60 + rang) dans chaque liste.
  //
  // PROFONDEUR : chaque liste remonte cent cinquante candidats avant fusion. On
  // n'en garde que --nb. C'est la marge dans laquelle un futur reclassement
  // viendra travailler.
  const PROFONDEUR = 150;
  const K_FUSION = 60;
  const debut = Date.now();
  const resultats = await client.query(
    `with derniere as (
       -- Sans date, la derniere version DE CHAQUE LANGUE. Avec une date, celle
       -- qui la couvre. Ne garder que la derniere tout court cachait le texte
       -- francais derriere le texte arabe du meme article.
       select distinct on (v.article_id, v.langue_faisant_foi)
              v.id, v.article_id, v.valid_from, v.valid_to,
              v.jort_reference, v.extraction_confiance
         from legal.article_versions v
        where $4::date is null
           or (v.valid_from <= $4::date and (v.valid_to is null or v.valid_to > $4::date))
        order by v.article_id, v.langue_faisant_foi, v.valid_from desc nulls last, v.version_num desc
     ),
     perimetre as (
       select c.id as chunk_id, d.article_id, a.corpus, a.numero,
              d.valid_from, d.valid_to, a.statut, a.abroge_par,
              s.libelle as nature, s.autorite,
              array_to_string(s.opposable_a, ', ') as opposable_a,
              d.jort_reference, d.extraction_confiance,
              c.ordinal, c.langue, c.texte, c.recherche, c.embedding,
              -- « consolide » sert l'affichage : une edition consolidee de la
              -- DGELF ne porte pas de reference au Journal Officiel, et c'est
              -- normal — ce n'est pas un numero du journal.
              exists (select 1 from legal.ingestion_queue q
                       where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE') as consolide,
              -- « permanent » sert le PERIMETRE, et ce n'est pas la meme chose.
              -- Une convention de non double imposition ratifiee est du droit en
              -- vigueur — la Constitution la place au-dessus de la loi interne —
              -- et une norme comptable est instituee par arrete. Les ranger avec
              -- les lois de finances les rendait invisibles hors --historique :
              -- la convention avec l'Arabie saoudite ne sortait jamais.
              exists (select 1 from legal.ingestion_queue q
                       where q.corpus = a.corpus
                         and q.type_document in ('CODE_CONSOLIDE', 'CONVENTION', 'NORME_COMPTABLE')) as permanent,
              coalesce(s.autorite, 'normative') = 'interpretative' as est_doctrine
         from legal.chunks c
         join derniere d on d.id = c.article_version_id
         join legal.articles a on a.id = d.article_id
         left join legal.sources s on s.code = a.source_code
        where c.embedding is not null
     ),
     retenus as (
       -- Par defaut : le droit en vigueur, c'est-a-dire les codes consolides.
       -- --doctrine y ajoute les notes communes, --historique les lois de finances.
       select * from perimetre
        where (permanent and not est_doctrine)
           or ($5 and est_doctrine)
           or ($3 and not permanent and not est_doctrine)
     ),
     mots as (
       -- DEUX tsquery par langue, et l'ordre entre elles a ete MESURE.
       --
       -- ts_rank_cd ne pondere pas par la rarete des mots — c'est ce qui le
       -- separe de BM25. Avec un OU, « article » pese autant que « 84 » : sur
       -- les sondages d'identite, l'arme lexicale rendait le bon article
       -- 0 fois sur 40. Avec un ET, elle le rend 37 fois sur 40.
       --
       -- Mais le ET seul ne rend rien sur une question longue, dont tous les
       -- mots ne peuvent pas figurer dans un meme fragment. On prend donc le
       -- ET quand il donne quelque chose, et le OU seulement quand le ET est
       -- vide. Mesure, avant / apres, a vingt resultats :
       --
       --   identite   80,0 %  ->  100,0 %
       --   objet      60,0 %  ->   85,0 %
       select websearch_to_tsquery('french', $6) as et_fr,
              websearch_to_tsquery('simple', $6) as et_simple,
              replace(websearch_to_tsquery('french', $6)::text, ' & ', ' | ')::tsquery as ou_fr,
              replace(websearch_to_tsquery('simple', $6)::text, ' & ', ' | ')::tsquery as ou_simple
     ),
     par_le_sens as (
       select chunk_id,
              embedding operator(extensions.<=>) $1::extensions.vector as distance,
              row_number() over (order by embedding operator(extensions.<=>) $1::extensions.vector) as rang
         from retenus
        order by distance
        limit $7
     ),
     -- La configuration suit la langue du fragment : « french » lemmatise,
     -- « simple » se contente de decouper — c'est ce qu'il faut pour l'arabe.
     stricts as (
       select r.chunk_id,
              ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], r.recherche,
                         case when r.langue = 'ar' then m.et_simple else m.et_fr end) as poids
         from retenus r, mots m
        where r.recherche @@ (case when r.langue = 'ar' then m.et_simple else m.et_fr end)
        order by poids desc limit $7
     ),
     larges as (
       select r.chunk_id,
              ts_rank_cd('{0.4, 0.5, 0.7, 1.0}'::float4[], r.recherche,
                         case when r.langue = 'ar' then m.ou_simple else m.ou_fr end) as poids
         from retenus r, mots m
        where r.recherche @@ (case when r.langue = 'ar' then m.ou_simple else m.ou_fr end)
        order by poids desc limit $7
     ),
     par_les_mots as (
       select chunk_id, row_number() over (order by poids desc) as rang
         from (select * from stricts
               union all
               select * from larges where not exists (select 1 from stricts)) l
     ),
     fusion as (
       -- Rang reciproque. Absent d'une liste = zero pour cette liste, pas une
       -- penalite : un identifiant exact que le vecteur ignore doit pouvoir
       -- gagner sur ses seuls mots.
       select coalesce(v.chunk_id, l.chunk_id) as chunk_id,
              coalesce(1.0 / ($8 + v.rang), 0) + coalesce(1.0 / ($8 + l.rang), 0) as score,
              v.rang as rang_sens, l.rang as rang_mots, v.distance
         from par_le_sens v
         full outer join par_les_mots l on l.chunk_id = v.chunk_id
     ),
     -- UN article, SON meilleur fragment. Sans cette regle, une question sur un
     -- taux remontait trois fois le meme article par trois de ses morceaux.
     classe as (
       select distinct on (r.article_id)
              r.corpus, r.numero, r.valid_from, r.valid_to, r.ordinal, r.langue,
              left(r.texte, 320) as extrait, r.consolide, r.statut, r.abroge_par,
              r.nature, r.autorite, r.opposable_a, r.jort_reference,
              r.extraction_confiance, r.permanent,
              f.score, f.rang_sens, f.rang_mots, f.distance
         from fusion f
         join retenus r on r.chunk_id = f.chunk_id
        order by r.article_id, f.score desc
     )
     -- Avec une date, le code consolide passe devant : c'est lui qui DIT l'etat
     -- du droit a cette date-la. Sans date, le score seul decide.
     select corpus, numero, valid_from, valid_to, ordinal, langue, extrait, consolide, permanent,
            statut, abroge_par, nature, autorite, opposable_a, jort_reference,
            extraction_confiance,
            round(distance::numeric, 4) as distance,
            rang_sens, rang_mots, round(score::numeric, 5) as score
       from classe
      order by (case when $4::date is null then 0 else (not permanent)::int end),
               score desc
      limit $2`,
    [`[${vecteur.join(",")}]`, nb, historique, jour, doctrine, question, PROFONDEUR, K_FUSION],
  );
  const ms = Date.now() - debut;

  console.log(`\nquestion : ${question}`);
  const perimetre = [
    "droit en vigueur : codes, conventions, normes comptables",
    doctrine ? "doctrine DGELF" : null,
    historique ? "lois de finances" : null,
  ]
    .filter(Boolean)
    .join(" + ");
  console.log(`etat     : ${jour ? `du droit au ${jour}` : "le plus recent"} — ${perimetre}`);
  console.log(`modele   : ${modele} — ${resultats.rowCount} resultats en ${ms} ms\n`);
  // Ce que valent les mots employes ci-dessous :
  //   opposable a — qui le texte OBLIGE. Une note commune n'oblige que
  //     l'administration : le contribuable peut s'en prevaloir, le juge n'est
  //     pas tenu de la suivre.
  //   statut — l'article tient-il encore. « abroge » vaut pour l'avenir,
  //     « annule » efface retroactivement. Voir la migration 20260901143000.
  //   provenance — verbatim, partiel (police dechiffree), incertain (OCR).
  // pg rend une date SQL comme un Date a minuit LOCALE ; passer par
  // toISOString() la ramene en UTC et affichait la veille — « 2022-12-31 » pour
  // une version valide a partir du 1er janvier 2023.
  const enDate = (d) => {
    if (!(d instanceof Date)) return String(d);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  for (const r of resultats.rows) {
    const validite = r.valid_to
      ? `${enDate(r.valid_from)} au ${enDate(r.valid_to)}`
      : `depuis ${enDate(r.valid_from)}`;
    // Une note commune ne se cite pas « art. 12 du corpus NC-2015 » mais
    // « note commune n° 12 de 2015 » : c'est ainsi qu'elle est referencee.
    const nc = /^NC-(\d{4})$/.exec(r.corpus);
    const intitule = nc
      ? `note commune n° ${r.numero} de ${nc[1]}`
      : `${r.corpus} art. ${r.numero}`;
    console.log(`— ${intitule}  (fragment ${r.ordinal}, ${r.langue}, ${validite})`);
    const nature = r.nature ?? "nature non determinee";
    const portee = r.opposable_a ? `opposable a : ${r.opposable_a}` : "opposable a personne";
    console.log(`  ${nature}${r.autorite ? ` (${r.autorite})` : ""} — ${portee}`);
    console.log(`  statut : ${r.statut}${r.abroge_par ? ` — ${r.abroge_par}` : ""}`);
    // Une edition consolidee de la DGELF ne porte pas de reference au Journal
    // Officiel : ce n'est pas un numero du journal, c'est une compilation.
    const sansRef = r.consolide ? "non relevee (edition consolidee)" : "non relevee";
    console.log(`  publication : ${r.jort_reference ?? sansRef} | texte ${r.extraction_confiance}`);
    const rangs =
      [r.rang_sens ? `sens #${r.rang_sens}` : null, r.rang_mots ? `mots #${r.rang_mots}` : null]
        .filter(Boolean)
        .join(", ") || "aucun rang";
    console.log(`  score ${r.score} (${rangs}${r.distance ? `, distance ${r.distance}` : ""})`);
    console.log(`  ${r.extrait.replace(/\s+/g, " ").trim()}\n`);
  }
  await client.end();
}

main().catch((e) => {
  console.error("echec :", e instanceof Error ? e.message : e);
  process.exit(1);
});
