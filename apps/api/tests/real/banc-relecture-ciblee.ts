/**
 * Le banc PAYANT de la relecture ciblée, sur le code de production (8 novembre 2026).
 *
 * Lancé par le workflow « Relecture Claude » (CI seulement : aucun appel payant depuis un
 * poste). Pour chaque pièce que le banc de référence laisse « aucune solution » et dont
 * l'image est au dépôt, il fait EXACTEMENT ce que fait le travail `relecture_cases` :
 * les mêmes cases (`casesARelire`), la même découpe, la même requête au modèle et à la
 * consigne EN BASE (`public.relecture_ciblee_configuration`, R8, R10), le même plan
 * candidat (`planCandidat`). Il écrit le relevé candidat ; le banc sans IA rejoué sur ces
 * relevés dit ce qui se prouve, et `outils/relecture-claude/relire.py bilan` compare.
 *
 * Le coût se calcule au tarif en base (`agents.model_pricing`), et la mesure s'arrête au
 * plafond (`--plafond`, en dollars). La clé vient de l'environnement, jamais d'un fichier.
 *
 *   node --experimental-strip-types apps/api/tests/real/banc-relecture-ciblee.ts \
 *     --base base.json --cache releves --racine . --sortie releves-relus \
 *     --journal journal.json --plafond 5
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import pg from "pg";

import { envoyerAClaude } from "../../src/malica/lecture/claude.ts";
import {
  casesARelire,
  corpsDeLaRequete,
  decouper,
  enLots,
  lireLaReponse,
  planCandidat,
  type ReponseBrute,
} from "../../src/malica/lecture/relecture-ciblee.ts";
import type { PageToken } from "../../src/malica/lecture/token-plan.ts";
import { lireLaConfiguration } from "../../src/malica/lecture/verification.ts";

const { values: a } = parseArgs({
  options: {
    base: { type: "string" },
    cache: { type: "string" },
    racine: { type: "string", default: "." },
    sortie: { type: "string" },
    journal: { type: "string" },
    plafond: { type: "string", default: "5" },
  },
});
if (!a.base || !a.cache || !a.sortie || !a.journal) {
  throw new Error("--base, --cache, --sortie et --journal sont requis");
}
const cle = process.env["ANTHROPIC_API_KEY"]?.trim();
if (!cle) throw new Error("ANTHROPIC_API_KEY absente : la mesure ne part pas");

const db = new pg.Client({ connectionString: process.env["DATABASE_URL_ADMIN"] });
await db.connect();
await db.query(`select set_config('malica.origine', 'serveur', false)`);
const config = lireLaConfiguration(
  (await db.query<{ r: unknown }>(`select public.relecture_ciblee_configuration() as r`)).rows[0]
    ?.r,
);
if (!config.modele || !config.consigne || !config.tarife) {
  throw new Error("relecture ciblée : modèle, consigne ou tarif absent en base (R8)");
}
const { rows: prix } = await db.query<{ role: string; entree: string; sortie: string }>(
  `select distinct on (role) role, price_in_per_mtok::text as entree, price_out_per_mtok::text as sortie
     from agents.model_pricing
    where model = $1 and role in ('chat', 'cache', 'cache_ecriture') and effective_from <= current_date
    order by role, effective_from desc`,
  [config.modele],
);
await db.end();
const tarif = (role: string) => {
  const p = prix.find((x) => x.role === role) ?? prix.find((x) => x.role === "chat")!;
  return { entree: Number(p.entree), sortie: Number(p.sortie) };
};
const cout = (u: NonNullable<ReponseBrute["usage"]>) =>
  ((u.input_tokens ?? 0) * tarif("chat").entree +
    (u.output_tokens ?? 0) * tarif("chat").sortie +
    (u.cache_read_input_tokens ?? 0) * tarif("cache").entree +
    (u.cache_creation_input_tokens ?? 0) * tarif("cache_ecriture").entree) /
  1e6;

if (existsSync(a.sortie)) rmSync(a.sortie, { recursive: true });
cpSync(a.cache, a.sortie, { recursive: true });

const plafond = Number(a.plafond);
const base = JSON.parse(readFileSync(a.base, "utf8")) as Array<{
  corpus: string;
  id: string;
  issue: string;
}>;
const journal: unknown[] = [];
let depense = 0;
for (const p of base) {
  if (p.issue !== "aucune" || !["algoria", "synthetique"].includes(p.corpus)) continue;
  const image = join(a.racine!, `outils/jeu-${p.corpus}/rendus/${p.id}.jpg`);
  const fichier = join(a.sortie, `${p.corpus}-${p.id}.json`);
  if (!existsSync(image) || !existsSync(fichier)) continue;
  const piece = `${p.corpus}-${p.id}`;
  if (depense >= plafond) {
    journal.push({ piece, panne: "plafond atteint" });
    continue;
  }
  const releve = JSON.parse(readFileSync(fichier, "utf8")) as { tokens: PageToken[] };
  const plan = releve.tokens.map((t) => ({ ...t, page: t.page ?? 1 }));
  const t0 = Date.now();
  const decoupees = await decouper(readFileSync(image), casesARelire(plan, config.casesMax));
  const decoupeS = (Date.now() - t0) / 1000;
  const lots = enLots(decoupees, config.lot);
  const t1 = Date.now();
  const reponses = await Promise.allSettled(
    lots.map((lot) =>
      envoyerAClaude<ReponseBrute>({
        apiKey: cle,
        corps: corpsDeLaRequete(config.modele, config.consigne, lot),
        signal: AbortSignal.timeout(30_000),
      }),
    ),
  );
  const appelS = (Date.now() - t1) / 1000;
  const usage: Record<string, number> = {};
  const pannes: string[] = [];
  let coutPiece = 0;
  for (const r of reponses) {
    if (r.status === "rejected") {
      pannes.push(r.reason instanceof Error ? r.reason.message.slice(0, 200) : String(r.reason));
      continue;
    }
    const u = r.value.reponse.usage ?? {};
    coutPiece += cout(u);
    for (const [k, v] of Object.entries(u))
      if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
  }
  depense += coutPiece;
  const relues = reponses.flatMap((r) =>
    r.status === "fulfilled" ? lireLaReponse(r.value.reponse) : [],
  );
  const { plan: candidat, changements } = planCandidat(plan, decoupees, relues);
  if (changements.length > 0) {
    writeFileSync(fichier, JSON.stringify({ ...releve, tokens: candidat }));
  }
  journal.push({
    piece,
    cases: decoupees.length,
    lots: lots.length,
    illisibles: relues.filter((r) => !r.lisible).length,
    changes: changements.map((c) => ({ ocr: c.ocr, claude: c.relu, candidat: c.candidat })),
    pannes,
    usage,
    cout: coutPiece,
    decoupeS,
    appelS,
    appelsS: reponses.map((r) => (r.status === "fulfilled" ? r.value.latencyMs / 1000 : 0)),
  });
  console.error(
    `${piece} : ${decoupees.length} cases, ${changements.length} relues autrement, ${appelS.toFixed(1)} s, ${coutPiece.toFixed(4)} $`,
  );
}
writeFileSync(a.journal, JSON.stringify({ modele: config.modele, depense, journal }, null, 1));
