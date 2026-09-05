/**
 * Mesurer la recherche, sans expert et sans invention.
 *
 * ====================================================== CE QU'IL MESURE
 *
 * UNE chose : la recherche ramene-t-elle le bon article ? C'est la seule qui se
 * mesure sans jugement humain, parce que `legal.sondages` ne contient que des
 * questions dont l'article attendu est connu PAR CONSTRUCTION.
 *
 * Il ne mesure PAS si la reponse de Regalica est juste. Cela demande un expert
 * qui signe, et c'est le role de `legal.banque_cas`.
 *
 * ====================================================== CE QU'IL COMPARE
 *
 * Trois classements sur le meme perimetre, dans la meme passe :
 *
 *   sens    les vecteurs seuls — ce que faisait la recherche jusqu'ici ;
 *   mots    l'index lexical seul ;
 *   fusion  les deux, par rang reciproque.
 *
 * Voir les trois cote a cote est tout l'interet : c'est ce qui dit si l'hybride
 * apporte quelque chose, au lieu de le supposer.
 *
 *   bun db/corpus/sonder.mjs [--echantillon 400] [--famille objet] [--nb 20]
 *   bun db/corpus/sonder.mjs --tout        # les 12 101 sondages, comptez une heure
 *
 * L'echantillon est TIRE DE FACON REPRODUCTIBLE : deux passes successives
 * interrogent les memes sondages, sinon la comparaison avant/apres ne vaut rien.
 *
 * BUN, PAS NODE : voir l'en-tete de vectoriser.mjs.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encoder, modeleEnVigueur } from "./empreintes.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const DEPOT = join(ICI, "..", "..");
const { default: pg } = await import(pathToFileURL(join(DEPOT, "node_modules/pg/lib/index.js")).href);

function env(fichier) {
  const v = {};
  try {
    for (const l of readFileSync(join(DEPOT, fichier), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
      if (m) v[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* absent : on leve plus bas */ }
  return v;
}
const API = env("apps/api/.env");
const WEB = env("apps/web/.env");

const PROFONDEUR = 150;
const K_FUSION = 60;

/**
 * Le rang de l'article attendu dans chacun des trois classements.
 *
 * Le perimetre est ici LE CORPUS ENTIER — codes, doctrine et lois de finances.
 * Un sondage porte sur une note commune ou sur une loi de finances autant que
 * sur un code : restreindre au droit en vigueur, comme le fait la recherche par
 * defaut, rendrait la moitie des sondages introuvables par construction.
 */
const REQUETE = `
with mots as (
  -- Deux tsquery par langue : voir la note dans rechercher.mjs.
  select websearch_to_tsquery('french', $2) as et_fr,
         websearch_to_tsquery('simple', $2) as et_simple,
         replace(websearch_to_tsquery('french', $2)::text, ' & ', ' | ')::tsquery as ou_fr,
         replace(websearch_to_tsquery('simple', $2)::text, ' & ', ' | ')::tsquery as ou_simple
),
-- On interroge TOUS les fragments, sans se limiter a la derniere version de
-- chaque article : c'est ce qui laisse l'index vectoriel faire son travail. Les
-- rangs sont ensuite ramenes a l'article, donc une edition ancienne du bon
-- article compte comme une trouvaille — ce qui est le cas.
par_le_sens as (
  select c.id as chunk_id, v.article_id,
         row_number() over (order by c.embedding operator(extensions.<=>) $1::extensions.vector) as rang
    from legal.chunks c
    join legal.article_versions v on v.id = c.article_version_id
   where c.embedding is not null
   order by c.embedding operator(extensions.<=>) $1::extensions.vector
   limit ${PROFONDEUR}
),
stricts as (
  select c.id as chunk_id,
         ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.recherche, case when c.langue = 'ar' then m.et_simple else m.et_fr end) as poids
    from legal.chunks c, mots m
   where c.recherche @@ (case when c.langue = 'ar' then m.et_simple else m.et_fr end)
   order by poids desc limit ${PROFONDEUR}
),
larges as (
  select c.id as chunk_id,
         ts_rank_cd('{0.4, 0.5, 0.7, 1.0}'::float4[], c.recherche, case when c.langue = 'ar' then m.ou_simple else m.ou_fr end) as poids
    from legal.chunks c, mots m
   where c.recherche @@ (case when c.langue = 'ar' then m.ou_simple else m.ou_fr end)
   order by poids desc limit ${PROFONDEUR}
),
lexical as (
  select * from stricts
  union all
  select * from larges where not exists (select 1 from stricts)
),
par_les_mots as (
  select l.chunk_id, v.article_id,
         row_number() over (order by l.poids desc) as rang
    from lexical l
    join legal.chunks c on c.id = l.chunk_id
    join legal.article_versions v on v.id = c.article_version_id
),
fusion as (
  select coalesce(v.chunk_id, l.chunk_id) as chunk_id,
         coalesce(v.article_id, l.article_id) as article_id,
         coalesce(1.0 / (${K_FUSION} + v.rang), 0) + coalesce(1.0 / (${K_FUSION} + l.rang), 0) as score
    from par_le_sens v
    full outer join par_les_mots l on l.chunk_id = v.chunk_id
),
-- Un article ne compte qu'une fois, par son meilleur fragment : c'est ainsi que
-- la recherche le rend.
rangs_sens as (
  select article_id, row_number() over (order by min(rang)) as rang
    from par_le_sens group by article_id
),
rangs_mots as (
  select article_id, row_number() over (order by min(rang)) as rang
    from par_les_mots group by article_id
),
rangs_fusion as (
  select article_id, row_number() over (order by max(score) desc) as rang
    from fusion group by article_id
)
select (select rang from rangs_sens s join legal.articles a on a.id = s.article_id
         where a.corpus = $3 and a.numero = $4) as rang_sens,
       (select rang from rangs_mots s join legal.articles a on a.id = s.article_id
         where a.corpus = $3 and a.numero = $4) as rang_mots,
       (select rang from rangs_fusion s join legal.articles a on a.id = s.article_id
         where a.corpus = $3 and a.numero = $4) as rang_fusion
`;

function taux(rangs, seuil) {
  const n = rangs.length;
  if (n === 0) return "—";
  const t = (100 * rangs.filter((r) => r !== null && r <= seuil).length) / n;
  return `${t.toFixed(1)} %`;
}

async function main() {
  const args = process.argv.slice(2);
  const val = (nom, def) => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : def;
  };
  const tout = args.includes("--tout");
  const echantillon = Number(val("--echantillon", 400));
  const famille = val("--famille", null);

  const client = new pg.Client({ connectionString: API["DATABASE_URL_ADMIN"] });
  await client.connect();
  const { model: modele } = await modeleEnVigueur(client);

  // Tirage REPRODUCTIBLE : la meme graine rend le meme echantillon, sinon
  // comparer deux passes reviendrait a comparer deux jeux differents.
  const { rows: sondages } = await client.query(
    `select id, famille, question, corpus_attendu, numero_attendu
       from legal.sondages
      where ($1::text is null or famille = $1)
      order by famille, md5(id::text || 'graine-regalica')
      ${tout ? "" : "limit 100000"}`,
    [famille],
  );
  const parFamille = new Map();
  for (const s of sondages) {
    const liste = parFamille.get(s.famille) ?? [];
    if (tout || liste.length < echantillon) liste.push(s);
    parFamille.set(s.famille, liste);
  }
  const choisis = [...parFamille.values()].flat();
  console.log(`modele    ${modele}`);
  console.log(`sondages  ${choisis.length} (${[...parFamille].map(([f, l]) => `${f} ${l.length}`).join(", ")})\n`);

  const resultats = new Map();
  const LOT = 10;
  const debut = Date.now();
  for (let i = 0; i < choisis.length; i += LOT) {
    const lot = choisis.slice(i, i + LOT);
    const { vecteurs } = await encoder(
      lot.map((s) => s.question),
      "query",
      { base: WEB["QWEN_BASE_URL"], cle: WEB["QWEN_API_KEY"], modele },
    );
    for (let j = 0; j < lot.length; j += 1) {
      const s = lot[j];
      const { rows } = await client.query(REQUETE, [
        `[${vecteurs[j].join(",")}]`,
        s.question,
        s.corpus_attendu,
        s.numero_attendu,
      ]);
      const liste = resultats.get(s.famille) ?? [];
      liste.push(rows[0]);
      resultats.set(s.famille, liste);
    }
    if ((i + LOT) % 100 < LOT) {
      const s = Math.round((Date.now() - debut) / 1000);
      process.stdout.write(`  ${Math.min(i + LOT, choisis.length)}/${choisis.length} — ${s} s\r`);
    }
  }
  console.log(`  ${choisis.length}/${choisis.length} — ${Math.round((Date.now() - debut) / 1000)} s\n`);

  console.log("l'article attendu est-il rendu, et a quel rang ?\n");
  console.log("famille    classement   rang 1    rang 5    rang 20");
  console.log("--------------------------------------------------");
  for (const [f, liste] of resultats) {
    for (const [nom, cle] of [["sens  ", "rang_sens"], ["mots  ", "rang_mots"], ["fusion", "rang_fusion"]]) {
      const rangs = liste.map((r) => r[cle]);
      console.log(
        `${f.padEnd(10)} ${nom}   ` +
          `${taux(rangs, 1).padStart(7)}   ${taux(rangs, 5).padStart(7)}   ${taux(rangs, 20).padStart(7)}`,
      );
    }
    console.log("");
  }
  await client.end();
}

main().catch((e) => {
  console.error("echec :", e instanceof Error ? e.message : e);
  process.exit(1);
});
