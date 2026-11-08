/**
 * L'épreuve RÉELLE du conseil cité : le jeu entier, contre la vraie API, le
 * vrai corpus et le vrai Claude.
 *
 * ================================================================= CE QU'ELLE MESURE
 *
 * Pour chaque question de `src/malica/conseil/epreuve-conseil.json` : la
 * réponse est-elle juste, la citation désigne-t-elle le bon article dans la
 * bonne version, un piège obtient-il un refus, et combien a coûté la
 * question (au tarif de `agents.model_pricing`). Le bilan s'imprime en
 * clair ; `--sortie` écrit le détail en JSON.
 *
 * ================================================================= CE QU'IL LUI FAUT
 *
 * Une API qui tourne avec `ANTHROPIC_API_KEY`, `QWEN_API_KEY`,
 * `QWEN_BASE_URL`, sur une base où le corpus est chargé ET encodé
 * (`db/corpus/charger-depuis-l-archive.mjs`, puis `db/corpus/vectoriser.mjs`),
 * et un compte membre d'une organisation à juridiction renseignée. Par
 * défaut, le dirigeant des comptes de parcours.
 *
 *   MALICA_API_URL=http://localhost:3000 \
 *   node --experimental-strip-types apps/api/tests/real/conseil-cite.ts \
 *     [--cas id1,id2] [--sortie bilan.json] [--exiger]
 *
 * `--exiger` fait échouer la commande si un piège n'obtient pas son refus,
 * si deux versions d'un article sont citées ensemble, ou si moins de 80 %
 * des citations sont justes. CHAQUE QUESTION EST UN APPEL PAYANT.
 */

import { readFileSync, writeFileSync } from "node:fs";

import type { ResultatDuConseilCite } from "../../src/malica/conseil/conseil-cite.ts";
import {
  bilanDeLEpreuve,
  bilanEnTexte,
  lireLeJeu,
  noterLeCas,
  type NoteDuCas,
} from "../../src/malica/conseil/epreuve-conseil.ts";

const COMPTES = JSON.parse(
  readFileSync(new URL("../../../../outils/comptes-de-parcours.json", import.meta.url), "utf8"),
) as { motDePasse: string; dirigeant: { email: string } };

function argument(nom: string): string | null {
  const i = process.argv.indexOf(nom);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const base = (process.env["MALICA_API_URL"] ?? "http://localhost:3000").replace(/\/+$/, "");
const email = process.env["MALICA_EMAIL"] ?? COMPTES.dirigeant.email;
const motDePasse = process.env["MALICA_MOTDEPASSE"] ?? COMPTES.motDePasse;

const jeu = lireLeJeu(
  JSON.parse(
    readFileSync(new URL("../../src/malica/conseil/epreuve-conseil.json", import.meta.url), "utf8"),
  ),
);
const retenus = argument("--cas")
  ?.split(",")
  .map((s) => s.trim());
const cas = retenus ? jeu.filter((c) => retenus.includes(c.id)) : jeu;
if (cas.length === 0) throw new Error("aucun cas retenu");

const connexion = await fetch(`${base}/auth/connexion`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, motDePasse }),
});
if (!connexion.ok) throw new Error(`connexion refusée (${connexion.status})`);
const { jeton } = (await connexion.json()) as { jeton: string };
const entetes = { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" };

const rpc = await fetch(`${base}/rpc`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ depot: "identite", methode: "listMyOrganizations", args: [] }),
});
const organisations = (
  (await rpc.json()) as { resultat: Array<{ id: string; jurisdiction: string | null }> }
).resultat;
const tenantId = process.env["MALICA_TENANT"] ?? organisations.find((o) => o.jurisdiction)?.id;
if (!tenantId) throw new Error("aucune organisation à juridiction renseignée pour ce compte");

const notes: NoteDuCas[] = [];
const detail: Array<{
  id: string;
  note: NoteDuCas;
  resultat: ResultatDuConseilCite | null;
  erreur?: string;
}> = [];

for (const c of cas) {
  const reponse = await fetch(`${base}/malica/conseil-cite`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ tenantId, question: c.question, locale: c.locale, jour: c.jour }),
  });
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
    const erreur = corps?.erreur ?? String(reponse.status);
    console.log(`✗ ${c.id} — ERREUR ${erreur}`);
    // Une erreur n'est ni une réponse ni un refus : elle compte comme un échec.
    const echec: NoteDuCas = {
      id: c.id,
      type: c.attendu.type,
      reponseJuste: false,
      citationJuste: false,
      refusCorrect: false,
      fauxRefus: false,
      marqueursManquants: [],
      modele: null,
      coutUsd: null,
      latencyMs: 0,
      nonCitees: 0,
      chiffresNonCites: 0,
      versionsMelangees: false,
      citationsRejetees: 0,
    };
    notes.push(echec);
    detail.push({ id: c.id, note: echec, resultat: null, erreur });
    continue;
  }
  const r = (await reponse.json()) as ResultatDuConseilCite;
  const note = noterLeCas(c, r);
  notes.push(note);
  detail.push({ id: c.id, note, resultat: r });
  const ok = note.reponseJuste && note.citationJuste;
  console.log(
    `${ok ? "✓" : "✗"} ${c.id} — ${r.refus ? "REFUS" : "réponse"} · ${r.modele ?? "sans appel"} · ` +
      `${r.coutUsd ?? "?"} $ · sources : ${r.sources.map((s) => `${s.corpus} ${s.numero ?? s.code}@${s.validFrom}`).join(", ") || "aucune"}` +
      (note.marqueursManquants.length ? ` · manque : ${note.marqueursManquants.join(" ; ")}` : ""),
  );
}

const bilan = bilanDeLEpreuve(notes);
console.log(`\n${bilanEnTexte(bilan)}`);

const sortie = argument("--sortie");
if (sortie) writeFileSync(sortie, JSON.stringify({ bilan, detail }, null, 2));

if (process.argv.includes("--exiger")) {
  const fautes: string[] = [];
  if (bilan.pieges.refusCorrects < bilan.pieges.total) fautes.push("un piège a obtenu une réponse");
  if (bilan.versionsMelangees > 0) fautes.push("deux versions d'un article citées ensemble");
  if (bilan.reponses.citationsJustes < 0.8 * bilan.reponses.total)
    fautes.push("moins de 80 % de citations justes");
  if (fautes.length > 0) {
    console.error(`\nÉPREUVE ÉCHOUÉE : ${fautes.join(" ; ")}`);
    process.exit(1);
  }
}
