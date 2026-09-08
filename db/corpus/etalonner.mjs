/**
 * Etalonner le seuil de pertinence de la recherche juridique.
 *
 * ============================================================== LE PROBLEME
 *
 * `chercherDansLeDroit` ecarte les fragments au-dela d'une distance. Ce seuil
 * decide de deux erreurs opposees :
 *
 *   trop haut  — du texte hors sujet entre dans la reponse. Malica cite
 *                alors un article REEL a l'appui d'une affirmation fausse.
 *                C'est le pire cas : la citation rend l'erreur credible.
 *   trop bas   — le corpus se tait alors qu'il contient la reponse, et
 *                Malica dit « je n'ai pas ce texte » a tort.
 *
 * On ne devine pas ce seuil. On le mesure : des questions qui DOIVENT trouver,
 * des questions qui ne doivent RIEN trouver, et on regarde ou les deux nuages
 * se separent.
 *
 *   node db/corpus/etalonner.mjs
 *
 * Le tirage est reproductible : les questions sont ecrites ici, pas tirees au
 * hasard. Quand le corpus grossit, on rejoue et on compare.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function env(fichier) {
  const o = {};
  for (const l of readFileSync(join(RACINE, fichier), "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}

const API = env("apps/api/.env");
const WEB = env("apps/web/.env");

/**
 * Ce que le corpus DOIT savoir. Des questions qu'un dirigeant tunisien pose
 * vraiment, sur des matieres que le corpus couvre.
 */
const ATTENDUES = [
  "Quel est le delai de depot de la declaration mensuelle de TVA ?",
  "Quelle est la penalite de retard en cas de paiement tardif de l'impot ?",
  "Une note commune de la DGELF est-elle opposable au contribuable ?",
  "Quelles sont les conditions de deduction de la TVA sur les achats ?",
  "Qu'est-ce que le droit de timbre sur les factures ?",
  "Quelles sanctions en cas de defaut de declaration d'employeur ?",
  "Comment se calcule l'acompte provisionnel ?",
  "Quelles sont les obligations de facturation d'un assujetti a la TVA ?",
];

/**
 * Le hors-sujet franc : rien dans le corpus n'a de rapport avec la question.
 * C'est CE nuage que le seuil doit tenir dehors.
 */
const ETRANGERES = [
  "Quelle est la recette traditionnelle du couscous tunisien ?",
  "Comment changer la courroie de distribution d'une voiture ?",
  "Quelle est la meteo prevue a Sfax la semaine prochaine ?",
  "Comment installer une base de donnees PostgreSQL sur Windows ?",
  "Quel est le programme du festival de Carthage ?",
  "Combien coute un billet d'avion Tunis-Paris ?",
];

/**
 * Le hors-JURIDICTION : du droit fiscal, mais d'un autre pays.
 *
 * ================================================ CE QUE LE SEUIL NE PEUT PAS
 *
 * Ces questions remontent des articles tunisiens a courte distance, et c'est
 * NORMAL : « TVA en France » et « TVA en Tunisie » parlent de la meme chose.
 * La recherche fait son travail ; aucun seuil ne les distingue des questions
 * legitimes sans faire taire ces dernieres.
 *
 * Ce nuage ne se traite donc PAS par le seuil, mais par la consigne : le
 * corpus est tunisien, et Malica doit refuser une question sur un autre
 * droit meme quand elle a du texte proche sous les yeux. On les mesure ici
 * pour verifier qu'ils restent au-dessus des questions legitimes — le jour ou
 * ils passeraient dessous, la consigne serait le seul rempart, et il faudrait
 * le savoir.
 */
const HORS_JURIDICTION = [
  "Quel est le taux de la TVA intracommunautaire en France ?",
  "Comment fonctionne le credit d'impot recherche francais ?",
  "Quelles sont les regles de la Securite sociale belge ?",
];

async function encoder(client, question) {
  const tarif = await client.query(
    `select model from agents.model_pricing
      where role = 'embedding' and effective_from <= current_date
        and (effective_to is null or effective_to > current_date)
      order by effective_from desc limit 1`,
  );
  const modele = tarif.rows[0]?.model;
  if (!modele) throw new Error("aucun modele d'empreinte en vigueur");

  const rep = await fetch(
    `${WEB["QWEN_BASE_URL"].replace(/\/+$/, "")}/compatible-mode/v1/embeddings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WEB["QWEN_API_KEY"]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: modele, input: [question], dimensions: 1024 }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!rep.ok) throw new Error(`encodage : ${rep.status} ${await rep.text()}`);
  return (await rep.json()).data[0].embedding;
}

/** La meme requete que le depot `corpus`, reduite a ce qu'on mesure. */
async function plusProche(client, vecteur) {
  const { rows } = await client.query(
    `with derniere as (
       select distinct on (v.article_id, v.langue_faisant_foi) v.id, v.article_id
         from legal.article_versions v
        order by v.article_id, v.langue_faisant_foi, v.valid_from desc nulls last,
                 v.version_num desc
     ),
     proches as (
       select distinct on (d.article_id)
              a.corpus, a.numero,
              exists (select 1 from legal.ingestion_queue q
                       where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE') as consolide,
              coalesce(s.autorite,'normative') = 'interpretative' as est_doctrine,
              c.embedding operator(extensions.<=>) $1::extensions.vector as distance
         from legal.chunks c
         join derniere d on d.id = c.article_version_id
         join legal.articles a on a.id = d.article_id
         left join legal.sources s on s.code = a.source_code
        where c.embedding is not null
        order by d.article_id, distance
     )
     select corpus, numero, round(distance::numeric, 4) as distance
       from proches
      where (consolide and not est_doctrine) or est_doctrine
      order by distance limit 3`,
    [`[${vecteur.join(",")}]`],
  );
  return rows;
}

const client = new pg.Client({
  connectionString: API["DATABASE_URL_ADMIN"] ?? API["DATABASE_URL"],
});
await client.connect();

const mesures = { attendues: [], horsJuridiction: [], etrangeres: [] };

for (const [famille, questions] of [
  ["attendues", ATTENDUES],
  ["horsJuridiction", HORS_JURIDICTION],
  ["etrangeres", ETRANGERES],
]) {
  console.log(`\n===== ${famille.toUpperCase()} =====`);
  for (const q of questions) {
    const v = await encoder(client, q);
    const top = await plusProche(client, v);
    const d = Number(top[0]?.distance ?? 9);
    mesures[famille].push(d);
    const ou = top[0] ? `${top[0].corpus} art. ${top[0].numero}` : "(rien)";
    console.log(`  ${d.toFixed(4)}  ${q.slice(0, 62).padEnd(62)} → ${ou}`);
  }
}

const stat = (xs) => {
  const t = [...xs].sort((a, b) => a - b);
  return {
    min: t[0],
    med: t[Math.floor(t.length / 2)],
    max: t[t.length - 1],
  };
};
const a = stat(mesures.attendues);
const j = stat(mesures.horsJuridiction);
const e = stat(mesures.etrangeres);

console.log(`\n===== VERDICT =====`);
console.log(
  `  doivent trouver    : min ${a.min.toFixed(4)}  med ${a.med.toFixed(4)}  MAX ${a.max.toFixed(4)}`,
);
console.log(
  `  hors juridiction   : min ${j.min.toFixed(4)}  med ${j.med.toFixed(4)}  max ${j.max.toFixed(4)}   (a la consigne, pas au seuil)`,
);
console.log(
  `  hors sujet         : MIN ${e.min.toFixed(4)}  med ${e.med.toFixed(4)}  max ${e.max.toFixed(4)}`,
);

// Le seuil separe « doivent trouver » de « hors sujet ». Le hors-juridiction
// n'entre pas dans ce calcul : il se refuse par la consigne.
if (a.max < e.min) {
  const seuil = (a.max + e.min) / 2;
  console.log(`\n  Les deux nuages se separent. Marge : ${(e.min - a.max).toFixed(4)}`);
  console.log(`  Seuil conseille : ${seuil.toFixed(2)}`);
  console.log(`    — il laisse passer toutes les questions legitimes (max ${a.max.toFixed(4)}),`);
  console.log(`    — il tient dehors tout le hors-sujet (min ${e.min.toFixed(4)}).`);
} else {
  console.log(
    `\n  Les deux nuages SE CHEVAUCHENT sur [${e.min.toFixed(4)} ; ${a.max.toFixed(4)}].`,
  );
  console.log(`  Aucun seuil ne separe parfaitement. R2 dit de refuser plutot que`);
  console.log(`  de deviner : on se pose au plus bas.`);
  console.log(`  Seuil conseille : ${(Math.floor(e.min * 100) / 100).toFixed(2)}`);
}

if (j.min < a.max) {
  console.log(`\n  ALERTE : une question hors juridiction (${j.min.toFixed(4)}) remonte PLUS PRES`);
  console.log(`  qu'une question legitime (${a.max.toFixed(4)}). Le seuil ne peut rien pour elle.`);
  console.log(`  Verifier que la consigne refuse bien un droit etranger.`);
}

await client.end();
