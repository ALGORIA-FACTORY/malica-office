/**
 * Les empreintes vectorielles du corpus juridique.
 *
 * ====================================================== CE QUE FAIT CE SCRIPT
 *
 *   1. il lit le modele d'empreinte dans `agents.model_pricing` (role
 *      « embedding », en vigueur ce jour) — le nom du modele n'est ecrit nulle
 *      part ici, R8 ;
 *   2. il fragmente les versions d'article qui n'ont pas encore de fragment ;
 *   3. il encode les fragments sans empreinte, par lots, et inscrit avec chaque
 *      empreinte la ligne de tarif qui l'a produite.
 *
 * Il est REPRENABLE : tout est fait par « ce qui manque ». Une interruption se
 * rattrape en relancant, sans doublon et sans repayer ce qui est deja encode.
 *
 * ====================================================== CE QU'IL NE FAIT PAS
 *
 * Il n'invente aucun texte. Un fragment porte un extrait exact de
 * `legal.article_versions`, avec ses bornes. La recherche remonte donc toujours
 * a un texte que l'on peut relire dans la version, jamais a un resume.
 *
 *   bun db/corpus/vectoriser.mjs [--limite N]
 *
 * BUN, PAS NODE. dashscope-intl.aliyuncs.com ne se resout qu'en IPv6 (NAT64)
 * depuis ce poste : le fetch de Node expire en ETIMEDOUT, celui de Bun passe.
 * Le meme piege existe avec `localhost` sur l'API locale, qui n'ecoute qu'en
 * IPv4. Ce n'est pas une preference de style, c'est la seule qui fonctionne.
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

/** Lit un .env sans dependance : ce script tourne hors de tout bundler. */
function env(fichier) {
  const valeurs = {};
  let contenu = "";
  try {
    contenu = readFileSync(join(DEPOT, fichier), "utf8");
  } catch {
    return valeurs;
  }
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(ligne);
    if (!m) continue;
    valeurs[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return valeurs;
}

const API = env("apps/api/.env");
const WEB = env("apps/web/.env");

function exiger(nom, valeur) {
  if (!valeur) throw new Error(`${nom} manquante — renseignez-la dans le .env correspondant.`);
  return valeur;
}

// ---------------------------------------------------------------- decoupage
//
// 1800 caracteres, 200 de recouvrement. Le recouvrement evite qu'une phrase
// coupee en deux disparaisse des deux fragments. On coupe de preference sur une
// fin de phrase ou un saut de ligne, jamais au milieu d'un mot.
const TAILLE = 1800;
const RECOUVREMENT = 200;

function fragmenter(texte) {
  const propre = texte.replace(/\r\n/g, "\n").trim();
  if (propre.length <= TAILLE) return [propre];
  const morceaux = [];
  let debut = 0;
  while (debut < propre.length) {
    let fin = Math.min(debut + TAILLE, propre.length);
    if (fin < propre.length) {
      const fenetre = propre.slice(debut, fin);
      const coupe = Math.max(
        fenetre.lastIndexOf("\n"),
        fenetre.lastIndexOf(". "),
        fenetre.lastIndexOf("، "),
        fenetre.lastIndexOf("؛"),
      );
      if (coupe > TAILLE / 2) fin = debut + coupe + 1;
    }
    const bout = propre.slice(debut, fin).trim();
    if (bout.length > 0) morceaux.push(bout);
    if (fin >= propre.length) break;
    debut = Math.max(fin - RECOUVREMENT, debut + 1);
  }
  return morceaux;
}

async function main() {
  const args = process.argv.slice(2);
  const limite = Number(args[args.indexOf("--limite") + 1]) || Infinity;

  const client = new pg.Client({
    connectionString: exiger("DATABASE_URL_ADMIN", API["DATABASE_URL_ADMIN"]),
  });
  await client.connect();

  // 1. Le modele vient de la table qui le tarife. Jamais d'une constante.
  const {
    id: pricingId,
    provider,
    model,
    price_in_per_mtok: prix,
    currency,
    sovereign,
  } = await modeleEnVigueur(client);
  console.log(
    `modele    ${provider}/${model}  (${prix} ${currency}/Mjeton, souverain=${sovereign})`,
  );

  const base = exiger("QWEN_BASE_URL", WEB["QWEN_BASE_URL"]);
  const cle = exiger("QWEN_API_KEY", WEB["QWEN_API_KEY"]);

  // 2. Fragmenter ce qui ne l'est pas encore.
  const aFragmenter = await client.query(
    `select v.id, v.langue_faisant_foi, (v.texte_ar is not null) as est_arabe,
            coalesce(v.texte_ar, v.texte_fr) as texte
       from legal.article_versions v
      where coalesce(v.texte_ar, v.texte_fr) is not null
        and not exists (select 1 from legal.chunks c where c.article_version_id = v.id)
      order by v.id`,
  );
  console.log(`versions a fragmenter : ${aFragmenter.rowCount}`);

  let fragments = 0;
  for (const v of aFragmenter.rows) {
    // La langue du FRAGMENT est celle du texte reellement pris, pas celle qui
    // fait foi : 4 519 versions declarent l'arabe faisant foi et ne portent que
    // du francais. Etiqueter ces fragments « ar » serait un mensonge de plus.
    const langue = v.est_arabe ? "ar" : "fr";
    const morceaux = fragmenter(v.texte);
    for (let i = 0; i < morceaux.length; i += 1) {
      await client.query(
        // L'en-tete se COMPOSE en base, a partir des champs de l'article :
        // aucun appel de modele, aucune invention possible. Il accompagne le
        // fragment a l'encodage et ne fait pas partie du texte servi.
        `insert into legal.chunks (article_version_id, ordinal, langue, texte, caracteres, entete)
         select $1, $2, $3, $4, length($4),
                legal.entete_de_fragment(a.corpus, a.numero, w.edition_min, a.source_code, a.statut)
           from legal.article_versions w
           join legal.articles a on a.id = w.article_id
          where w.id = $1
         on conflict (article_version_id, ordinal) do nothing`,
        [v.id, i + 1, langue ?? "fr", morceaux[i]],
      );
      fragments += 1;
    }
  }
  console.log(`fragments crees       : ${fragments}`);

  // 3. Encoder ce qui n'a pas d'empreinte.
  const total = await client.query(
    `select count(*)::int as n from legal.chunks where embedding is null`,
  );
  console.log(`fragments a encoder   : ${total.rows[0].n}`);

  const LOT = 10; // borne du fournisseur
  let faits = 0;
  let jetons = 0;
  const debut = Date.now();

  for (;;) {
    if (faits >= limite) break;
    const lot = await client.query(
      `select id, coalesce(entete || E'\n\n', '') || texte as a_encoder
         from legal.chunks where embedding is null
        order by article_version_id, ordinal limit $1`,
      [LOT],
    );
    if (lot.rowCount === 0) break;

    let resultat;
    try {
      resultat = await encoder(
        lot.rows.map((r) => r.a_encoder),
        "document",
        { base, cle, modele: model },
      );
    } catch (e) {
      // Un echec de lot ne doit pas perdre le travail deja fait : on s'arrete
      // bruyamment, et la relance reprend exactement ici.
      console.error(
        `\nechec sur un lot de ${lot.rowCount} : ${e instanceof Error ? e.message : e}`,
      );
      console.error(`${faits} fragments encodes avant l'arret. Relancez pour reprendre.`);
      await client.end();
      process.exit(1);
    }

    for (let i = 0; i < lot.rows.length; i += 1) {
      await client.query(
        `update legal.chunks
            set embedding = $1::extensions.vector, pricing_id = $2, encode_le = now()
          where id = $3`,
        [`[${resultat.vecteurs[i].join(",")}]`, pricingId, lot.rows[i].id],
      );
    }
    faits += lot.rowCount;
    jetons += resultat.usage?.total_tokens ?? 0;
    if (faits % 200 === 0 || lot.rowCount < LOT) {
      const s = Math.round((Date.now() - debut) / 1000);
      console.log(`  ${faits} encodes — ${jetons} jetons — ${s} s`);
    }
  }

  const cout = (jetons / 1e6) * Number(prix);
  console.log(
    `\n${faits} fragments encodes, ${jetons} jetons, cout ${cout.toFixed(4)} ${currency}`,
  );

  const reste = await client.query(
    `select count(*)::int as n from legal.chunks where embedding is null`,
  );
  console.log(`fragments sans empreinte restants : ${reste.rows[0].n}`);
  await client.end();
}

main().catch((e) => {
  console.error("echec :", e instanceof Error ? e.message : e);
  process.exit(1);
});
