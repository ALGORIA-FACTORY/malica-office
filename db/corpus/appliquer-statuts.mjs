/**
 * Corrige le statut des articles « abrogé » dont le texte dit autre chose (C1).
 *
 *   node db/corpus/appliquer-statuts.mjs <adresse>            # rapport, n'écrit rien
 *   node db/corpus/appliquer-statuts.mjs <adresse> --ecrire   # applique, en une transaction
 *
 * La règle est dans `statuts.mjs` (fonction pure, éprouvée). Ici on ne fait que
 * lire les articles, la poser, et écrire ce qu'elle tranche. Ce qu'elle ne
 * tranche pas (« incertain ») n'est PAS modifié : il est listé pour l'expert.
 *
 * Retour arrière : le rapport liste les identifiants modifiés ; remettre
 * `statut = 'abroge'` sur ces identifiants rétablit l'état antérieur
 * (`abroge_par` n'est jamais touché).
 *
 * L'adresse n'est jamais affichée ; on dit seulement le nom de la base visée.
 * Staging et production : lecture seule tant que le dirigeant n'a pas donné
 * son accord — ce script n'écrit que si `--ecrire` est passé.
 */
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { classerAbrogation } from "./statuts.mjs";

const require = createRequire(import.meta.url);
const DEPOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pg = require(join(DEPOT, "node_modules", "pg"));

const adresse =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env["DATABASE_URL_ADMIN"];
if (!adresse) {
  console.error("adresse de la base absente (argument ou DATABASE_URL_ADMIN)");
  process.exit(2);
}
const ecrire = process.argv.includes("--ecrire");

const c = new pg.Client({ connectionString: adresse });
await c.connect();
try {
  await c.query(ecrire ? "begin" : "begin read only");
  const { rows: base } = await c.query("select current_database() as nom");
  console.log(`base visée : ${base[0].nom} — ${ecrire ? "ÉCRITURE" : "lecture seule"}`);

  const { rows } = await c.query(
    `select a.id, a.corpus, a.numero, coalesce(v.texte_fr, v.texte_ar) as texte
       from legal.articles a
       join legal.article_versions v on v.article_id = a.id
        and v.valid_from <= current_date and (v.valid_to is null or v.valid_to > current_date)
      where a.statut = 'abroge'`,
  );

  // Un article peut avoir deux versions ouvertes (français, arabe) : il n'est
  // remis en vigueur que si toutes disent la même chose.
  const parArticle = new Map();
  for (const r of rows) {
    const verdict = classerAbrogation(r.texte).verdict;
    const deja = parArticle.get(r.id);
    if (!deja) parArticle.set(r.id, { ...r, verdict });
    else if (deja.verdict !== verdict) deja.verdict = "incertain";
  }
  const tri = { abroge: [], en_vigueur: [], incertain: [] };
  for (const r of parArticle.values()) tri[r.verdict].push(r);
  console.log(
    `abrogés à version ouverte : ${parArticle.size} — confirmés ${tri.abroge.length}, ` +
      `à remettre en vigueur ${tri.en_vigueur.length}, incertains ${tri.incertain.length}`,
  );
  for (const r of tri.incertain) console.log(`  INCERTAIN (expert) : ${r.corpus} art. ${r.numero}`);

  if (tri.en_vigueur.length > 0) {
    const ids = tri.en_vigueur.map((r) => r.id);
    if (ecrire) {
      const res = await c.query(
        "update legal.articles set statut = 'en_vigueur' where id = any($1::uuid[]) and statut = 'abroge'",
        [ids],
      );
      console.log(`écrit : ${res.rowCount} articles remis en vigueur`);
    }
    console.log(`identifiants (retour arrière) : ${ids.join(",")}`);
  }
  await c.query(ecrire ? "commit" : "rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(`échec : ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
