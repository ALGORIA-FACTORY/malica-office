/**
 * La mesure de référence du chat, AVANT sa reconstruction (lot A, 9 novembre 2026).
 *
 * Elle pose les questions de `epreuve-conseil.json` au chat tel qu'il tourne sur
 * un environnement réel (le staging), par sa route publique `/malica/demander`,
 * avec un compte d'essai, comme le ferait l'application. Rien n'est simulé : le
 * modèle, la recherche dans le corpus et la base sont ceux de l'environnement.
 *
 * Pour chaque question : le temps du premier octet reçu et le temps de la fin,
 * mesurés ici, côté client (le chat actuel ne rend rien en flux : le premier
 * octet arrive avec la réponse entière) ; la réponse ; la note de l'épreuve
 * (`noterLeCas`) — marqueurs, article cité, refus correct ou faux refus.
 *
 *   node --experimental-strip-types apps/api/tests/real/mesure-chat-reference.ts \
 *     --base https://staging.malica-office.algoria-factory.com --sortie <dossier>
 *
 *   --relire <dossier>   renote les réponses déjà enregistrées, sans aucun appel.
 *
 * Le mot de passe du compte d'essai vient de `outils/comptes-de-parcours.json`
 * (comptes fictifs du jeu de données) ; il n'est jamais affiché.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  bilanDeLEpreuve,
  lireLeJeu,
  noterLeCas,
  type CasDEpreuve,
  type NoteDuCas,
} from "../../src/malica/conseil/epreuve-conseil.ts";
import type { ResultatDuConseilCite } from "../../src/malica/conseil/conseil-cite.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    sortie: { type: "string" },
    cas: { type: "string" },
    relire: { type: "string" },
  },
});

const racine = new URL("../../../../", import.meta.url);
const jeu = lireLeJeu(
  JSON.parse(
    readFileSync(new URL("apps/api/src/malica/conseil/epreuve-conseil.json", racine), "utf8"),
  ),
).filter((c) => !values.cas || values.cas.split(",").includes(c.id));

interface Source {
  corpus: string;
  numero: string;
}

interface Mesure {
  id: string;
  locale: string;
  premierOctetMs: number;
  finMs: number;
  statut: number;
  clesRecues: string[];
  reponse: string;
  sources: Source[];
  retenue: boolean | null;
  note: NoteDuCas | null;
  articleCiteSansVersion: boolean;
  erreur: string | null;
}

/*
 * Un refus, dans les mots du chat actuel. Le premier relevé (9 novembre 2026) ne
 * reconnaissait que « je ne trouve pas » et a compté comme réponses les quatre
 * refus corrects des pièges (« Je ne peux pas vous répondre… relève du droit
 * français », « Ce n'est pas mon domaine »). La note est refaite sur les réponses
 * enregistrées (`--relire`), sans nouvel appel.
 */
const REFUS =
  /je ne trouve pas|ne figure pas dans les textes|je ne peux pas vous (répondre|donner)|ce n'est pas mon domaine|je ne traite que|لا أجد|لا يمكنني|I cannot find|I can(?:not|'t) answer|not in the texts/iu;

/** La note d'une réponse — les sources rendues sans leur version ne gagnent pas la citation. */
function noter(cas: CasDEpreuve, reponse: string, sources: Source[]) {
  const resultat = {
    refus: REFUS.test(reponse) || reponse.trim().length === 0,
    reponse,
    sources,
    modele: null,
    coutUsd: null,
    latencyMs: null,
    nonCitees: [],
    chiffresNonCites: [],
    chiffresRetires: [],
    versionsMelangees: false,
    citationsRejetees: 0,
  } as unknown as ResultatDuConseilCite;
  return {
    note: noterLeCas(cas, resultat),
    articleCiteSansVersion:
      cas.attendu.type === "reponse" &&
      cas.attendu.articles.some((a) =>
        sources.some(
          (s) =>
            s.corpus === a.corpus && s.numero.replace(/\s/g, "") === a.numero.replace(/\s/g, ""),
        ),
      ),
  };
}

const centile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! : 0;
};

function resumer(mesures: Mesure[], environnement: string, date: string) {
  const ok = mesures.filter((m) => m.statut === 200);
  const premiers = ok.map((m) => m.premierOctetMs);
  const fins = ok.map((m) => m.finMs);
  return {
    environnement,
    date,
    cas: mesures.length,
    reussis: ok.length,
    premierOctet: { mediane: centile(premiers, 50), p95: centile(premiers, 95) },
    fin: { mediane: centile(fins, 50), p95: centile(fins, 95) },
    retenues: ok.filter((m) => m.retenue === true).length,
    articlesCitesSansVersion: ok.filter((m) => m.articleCiteSansVersion).length,
    clesRecues: [...new Set(ok.flatMap((m) => m.clesRecues))].sort(),
    bilan: bilanDeLEpreuve(ok.flatMap((m) => (m.note ? [m.note] : []))),
  };
}

if (values.relire) {
  const fichier = join(values.relire, "mesures.json");
  const avant = JSON.parse(readFileSync(fichier, "utf8")) as {
    resume: { environnement: string; date: string };
    mesures: Array<Mesure & { sources?: Source[] }>;
  };
  const mesures = avant.mesures.map((m) => {
    const cas = jeu.find((c) => c.id === m.id);
    if (!cas || m.statut !== 200) return { ...m, sources: m.sources ?? [] };
    return { ...m, sources: m.sources ?? [], ...noter(cas, m.reponse, m.sources ?? []) };
  });
  const resume = resumer(mesures, avant.resume.environnement, avant.resume.date);
  writeFileSync(fichier, JSON.stringify({ resume, mesures }, null, 2));
  console.log(JSON.stringify(resume, null, 2));
  process.exit(0);
}

const base = (values.base ?? "").replace(/\/+$/, "");
if (!base.startsWith("https://")) throw new Error("--base : l'adresse https de l'environnement");
const sortie = values.sortie ?? "mesure-chat-reference";
mkdirSync(sortie, { recursive: true });

const comptes = JSON.parse(
  readFileSync(new URL("outils/comptes-de-parcours.json", racine), "utf8"),
) as { motDePasse: string; dirigeant: { email: string } };

async function json<T>(chemin: string, init: RequestInit & { jeton?: string } = {}): Promise<T> {
  const r = await fetch(`${base}${chemin}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.jeton ? { authorization: `Bearer ${init.jeton}` } : {}),
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${chemin} : ${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t) as T;
}

const { jeton } = await json<{ jeton: string }>("/auth/connexion", {
  method: "POST",
  body: JSON.stringify({ email: comptes.dirigeant.email, motDePasse: comptes.motDePasse }),
});
const moi = await json<{
  organisations: Array<{ id: string; kind?: string; type?: string }>;
}>("/moi", { jeton });
const pme = moi.organisations.find((o) => (o.kind ?? o.type) === "pme") ?? moi.organisations[0];
if (!pme) throw new Error("aucune organisation pour le compte d'essai");

const mesures: Mesure[] = [];
for (const cas of jeu) {
  const t0 = performance.now();
  let premier = 0;
  let statut = 0;
  let corps = "";
  try {
    const r = await fetch(`${base}/malica/demander`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ tenantId: pme.id, question: cas.question, locale: cas.locale }),
    });
    premier = performance.now() - t0;
    statut = r.status;
    corps = await r.text();
  } catch (e) {
    mesures.push({
      id: cas.id,
      locale: cas.locale,
      premierOctetMs: 0,
      finMs: Math.round(performance.now() - t0),
      statut: -1,
      clesRecues: [],
      reponse: "",
      sources: [],
      retenue: null,
      note: null,
      articleCiteSansVersion: false,
      erreur: e instanceof Error ? e.message : String(e),
    });
    continue;
  }
  const fin = performance.now() - t0;
  let r: Record<string, unknown> = {};
  try {
    r = JSON.parse(corps) as Record<string, unknown>;
  } catch {
    /* une réponse non JSON se garde telle quelle */
  }
  const reponse = typeof r["answer"] === "string" ? (r["answer"] as string) : "";
  const sources = (Array.isArray(r["sources"]) ? (r["sources"] as Array<Partial<Source>>) : []).map(
    (s) => ({ corpus: String(s.corpus ?? ""), numero: String(s.numero ?? "") }),
  );
  mesures.push({
    id: cas.id,
    locale: cas.locale,
    premierOctetMs: Math.round(premier),
    finMs: Math.round(fin),
    statut,
    clesRecues: Object.keys(r).sort(),
    reponse,
    sources,
    retenue: typeof r["retenue"] === "boolean" ? (r["retenue"] as boolean) : null,
    ...(statut === 200
      ? noter(cas, reponse, sources)
      : { note: null, articleCiteSansVersion: false }),
    erreur: statut === 200 ? null : corps.slice(0, 300),
  });
  process.stderr.write(`${cas.id} ${statut} ${Math.round(fin)} ms\n`);
}

const resume = resumer(mesures, base, new Date().toISOString());
writeFileSync(join(sortie, "mesures.json"), JSON.stringify({ resume, mesures }, null, 2));
console.log(JSON.stringify(resume, null, 2));
