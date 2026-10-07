/**
 * Relever une pièce réelle du staging, et en faire un cas du jeu d'or.
 *
 * ================================================================= POURQUOI
 *
 * Le jeu d'or doit porter de VRAIES pièces, avec leur plan de jetons tel que
 * l'œil l'a relevé. Recomposer un plan à la main produit un banc vert sur un
 * produit faux : c'est ce qui a laissé passer quatre défauts jusqu'au
 * 4 octobre 2026.
 *
 * Cet outil fait donc la seule chose qui ne se fait pas à la main : transcrire
 * le plan de jetons et la désignation effectivement employée.
 *
 * ============================= CE QU'IL NE REMPLIT PAS, ET C'EST LE POINT
 *
 * Il laisse `attendu` VIDE.
 *
 * Pré-remplir les valeurs attendues avec ce que la machine a lu rendrait le
 * banc tautologique : il vérifierait que le produit fait ce qu'il fait. Un jeu
 * d'or mesure l'écart entre le produit et LE PAPIER — donc les valeurs
 * attendues viennent de la facture, lues par un humain, validées par
 * l'expert-comptable.
 *
 * L'outil imprime en regard ce que la machine a lu, pour que le remplissage
 * soit rapide et que les écarts sautent aux yeux. Mais il ne décide rien, et
 * `jeu-d-or.test.ts` refuse un cas dont `attendu` est vide.
 *
 * ===================================================================== USAGE
 *
 * 1. Relever le JSON depuis le staging (une seule commande, lecture seule) :
 *
 *    ssh <serveur> "cd /srv/malica/depot && docker compose \
 *      --project-directory infra --env-file /srv/malica/.env \
 *      exec -T postgres psql -U postgres -d malica -t -A -c \"
 *        select jsonb_pretty(jsonb_agg(c)) from (
 *          select p.id as piece,
 *                 x.payload as extrait,
 *                 (select jsonb_agg(jsonb_build_object(
 *                           'page', t.page, 'ordinal', t.ordinal, 'text', t.text,
 *                           'x0', t.x0, 'y0', t.y0, 'x1', t.x1, 'y1', t.y1)
 *                         order by t.page, t.ordinal)
 *                    from capture.token_plan t where t.piece_id = p.id) as jetons,
 *                 (select jsonb_agg(jsonb_build_object(
 *                           'field', ci.field, 'page', ci.page,
 *                           'ordinal', d.ordinal, 'ordinalEnd', ci.ordinal_end)
 *                         order by ci.field)
 *                    from capture.citations ci
 *                    join capture.token_plan d on d.id = ci.token_id
 *                   where ci.piece_id = p.id) as citations,
 *                 o.legal_id as matricule_dossier
 *            from capture.pieces p
 *            join capture.extractions x on x.piece_id = p.id
 *            join identity.organizations o on o.id = p.tenant_id
 *           order by p.created_at) c\"" > pieces.json
 *
 * 2. En faire des cas :
 *
 *    node outils/relever-le-jeu-d-or.mjs pieces.json
 *
 * 3. Remplir `attendu` dans chaque fichier produit, en lisant les factures, et
 *    faire valider par l'expert-comptable.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [fichier] = process.argv.slice(2);
if (!fichier) {
  console.error("usage : node outils/relever-le-jeu-d-or.mjs <pieces.json>");
  process.exit(2);
}

const brut = readFileSync(fichier, "utf8").trim();
const pieces = JSON.parse(brut);
if (!Array.isArray(pieces) || pieces.length === 0) {
  console.error("aucune pièce dans ce fichier : le staging en porte-t-il ?");
  process.exit(1);
}

const DOSSIER = "apps/api/src/malica/lecture/jeu-d-or";
mkdirSync(DOSSIER, { recursive: true });

/** Un nom de fichier lisible, tiré du numéro de la pièce ou de son identifiant. */
function slug(piece, extrait, i) {
  const numero = extrait?.references?.numero ?? null;
  const base = numero ? `piece-${numero}` : `piece-${String(piece).slice(0, 8)}`;
  return `${String(i + 1).padStart(2, "0")}-${base}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const r = (n) => Math.round(Number(n) * 1e4) / 1e4;
const j = (v) => JSON.stringify(v);

/** Les citations, regroupées par champ, redonnent la désignation employée. */
function designationDepuisCitations(citations) {
  const par = new Map();
  for (const c of citations ?? []) {
    // Une même valeur peut être citée sous deux noms (`citerAussi`) : on garde
    // la première, qui est celle du champ d'origine.
    if (!par.has(c.field)) par.set(c.field, c);
  }
  return par;
}

/** « articles[0].total_ht » → { ordinal, ordinalEnd } tel que désigné. */
function refDe(par, champ) {
  const c = par.get(champ);
  if (!c) return "null";
  return c.ordinalEnd && c.ordinalEnd > c.ordinal
    ? `ref(${c.ordinal}, ${c.ordinalEnd})`
    : `ref(${c.ordinal})`;
}

const produits = [];

for (const [i, p] of pieces.entries()) {
  const extrait = p.extrait ?? {};
  const jetons = p.jetons ?? [];
  const par = designationDepuisCitations(p.citations);
  const nom = slug(p.piece, extrait, i);

  const articles = (extrait.articles ?? []).map(
    (_, k) => `      {
        designation: ${refDe(par, `articles[${k}].designation`)},
        quantity: ${refDe(par, `articles[${k}].quantity`)},
        unit_price_ht: ${refDe(par, `articles[${k}].unit_price_ht`)},
        unit_price_ttc: ${refDe(par, `articles[${k}].unit_price_ttc`)},
        total_ht: ${refDe(par, `articles[${k}].total_ht`)},
        tax_code: ${j(extrait.articles[k]?.tax_code ?? null)},
      },`,
  );
  const lignes = (extrait.lines ?? []).map(
    (l, k) => `      {
        label: ${j(l.label ?? "")},
        tax_code: ${j(l.tax_code ?? null)},
        base_ht: ${refDe(par, `lines[${k}].base_ht`)},
        vat_amount: ${refDe(par, `lines[${k}].vat_amount`)},
        ttc: ${refDe(par, `lines[${k}].ttc`)},
      },`,
  );
  const droits = (extrait.other_charges ?? []).map(
    (c, k) => `      { code: ${j(c.code)}, amount: ${refDe(par, `other_charges[${k}].amount`)} },`,
  );

  /*
   * Ce que la MACHINE a lu, mis en commentaire à côté de `attendu`. Il ne
   * remplit rien : il sert à remplir vite, et à voir les écarts.
   */
  const lu = Object.entries({
    document_kind: extrait.document_kind,
    issuer: extrait.issuer,
    document_date: extrait.document_date,
    "references.matricule_fiscal": extrait.references?.matricule_fiscal,
    "references.matricule_fiscal_client": extrait.references?.matricule_fiscal_client,
    "totals.base_ht": extrait.totals?.base_ht,
    "totals.vat": extrait.totals?.vat,
    "totals.ttc": extrait.totals?.ttc,
  })
    .map(([k, v]) => `   *   ${k.padEnd(38)} ${v === null || v === undefined ? "—" : v}`)
    .join("\n");

  const contenu = `/**
 * ${nom} — cas du jeu d'or, relevé le ${new Date().toISOString().slice(0, 10)}.
 *
 * Plan de jetons transcrit tel quel depuis \`capture.token_plan\` sur le staging,
 * pièce ${p.piece}. ${jetons.length} jetons.
 *
 * ================================================ À REMPLIR À LA MAIN
 *
 * \`attendu\` est VIDE, et doit être rempli EN LISANT LA FACTURE — pas en
 * recopiant ce que la machine a lu. Un jeu d'or qui reprend la sortie du
 * produit ne mesure que lui-même.
 *
 * Ce que la machine a lu, pour aller vite et voir les écarts :
 *
${lu}
 *
 * Les valeurs ci-dessus sont une AIDE, pas une vérité. L'expert-comptable
 * valide le contenu de \`attendu\`.
 */
import type { CasDOr } from "../jeu-d-or.ts";
import type { PageToken } from "../token-plan.ts";
import type { VisionSelection } from "../vision.ts";

const ref = (ordinal: number, ordinalEnd?: number) =>
  ordinalEnd === undefined ? { page: 1, ordinal } : { page: 1, ordinal, ordinalEnd };

const JETONS: PageToken[] = [
${jetons.map((t) => `  { page: ${t.page}, ordinal: ${t.ordinal}, text: ${j(t.text)}, x0: ${r(t.x0)}, y0: ${r(t.y0)}, x1: ${r(t.x1)}, y1: ${r(t.y1)} },`).join("\n")}
];

export const CAS: CasDOr = {
  nom: ${j(nom)},
  provenance:
    "relevé sur le staging · pièce ${p.piece} · " +
    "plan de jetons transcrit tel quel dans capture.token_plan, ${jetons.length} jetons",
  decimales: 3,
  matriculeDossier: ${j(p.matricule_dossier ?? null)},
  tokens: JETONS,
  designation: {
    document_kind: ${j(extrait.document_kind ?? null)},
    currency: ${j(extrait.currency ?? "TND")},
    issuer: ${refDe(par, "issuer")},
    document_date: ${refDe(par, "document_date")},
    references: {
      numero: ${refDe(par, "references.numero")},
      matricule_fiscal: ${refDe(par, "references.matricule_fiscal")},
      matricule_fiscal_client: ${refDe(par, "references.matricule_fiscal_client")},
    },
    lines: [
${lignes.join("\n")}
    ],
    articles: [
${articles.join("\n")}
    ],
    other_charges: [
${droits.join("\n")}
    ],
    totals: {
      base_ht: ${refDe(par, "totals.base_ht")},
      vat: ${refDe(par, "totals.vat")},
      ttc: ${refDe(par, "totals.ttc")},
    },
    overall_confidence: ${extrait.field_confidence?.overall ?? 0.5},
  } as unknown as VisionSelection,
  imprime: {
    // À remplir : ce que la facture IMPRIME, en clair, pour qu'un humain
    // puisse juger \`attendu\` dans six mois sans avoir la pièce sous les yeux.
  },
  attendu: {
    // À REMPLIR EN LISANT LA FACTURE. Vide, ce cas fait échouer le banc —
    // c'est voulu : un cas d'or non validé ne doit pas passer pour validé.
  },
};
`;

  const chemin = join(DOSSIER, `${nom}.ts`);
  writeFileSync(chemin, contenu, "utf8");
  produits.push({ nom, chemin, jetons: jetons.length });
  console.log(`  ${chemin}  (${jetons.length} jetons)`);
}

console.log(`\n${produits.length} cas relevé(s).`);
console.log("\nÀ faire maintenant, dans cet ordre :");
console.log("  1. remplir `attendu` et `imprime` dans chaque fichier, EN LISANT LA FACTURE ;");
console.log("  2. les déclarer dans JEU_D_OR (apps/api/src/malica/lecture/jeu-d-or.ts) ;");
console.log("  3. npm test — un cas dont `attendu` est vide fait rougir le banc.");
