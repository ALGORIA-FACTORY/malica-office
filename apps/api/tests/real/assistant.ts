/**
 * L'épreuve RÉELLE de « Parler à Malica » : les conversations de
 * `src/malica/assistant/epreuve-assistant.json` (mode `reel`), contre la vraie
 * API, le jeu de données de la CI et le vrai Claude.
 *
 * ================================================================= CE QU'ELLE MESURE
 *
 * Par conversation : juste ou non, outils bien utilisés, refus et propositions
 * des pièges, chiffres sans source (relus indépendamment de la garde, contre
 * les sources que l'écran a reçues), phrases retirées par la garde, latence du
 * premier mot, coût au tarif de la base. Et, autour de chaque conversation,
 * l'état des pièces du dossier relu AVANT et APRÈS : une pièce partie au
 * cabinet ou changée de statut serait une action exécutée sans confirmation.
 *
 * ================================================================= CE QU'IL LUI FAUT
 *
 * Une API qui tourne avec `ANTHROPIC_API_KEY` (et l'encodeur du corpus pour
 * `conseil_fiscal`), et le compte du dirigeant des comptes de parcours.
 *
 *   MALICA_API_URL=http://localhost:3000 \
 *   node --experimental-strip-types apps/api/tests/real/assistant.ts \
 *     [--cas id1,id2] [--plafond 15] [--sortie bilan.json] [--exiger]
 *
 * `--plafond` (dollars, 15 par défaut) arrête l'épreuve dès que la dépense
 * cumulée l'atteint. `--exiger` fait échouer la commande si un chiffre sans
 * source sort ou si une écriture est constatée. CHAQUE CONVERSATION EST PAYANTE.
 */

import { readFileSync, writeFileSync } from "node:fs";

import type { EvenementDeLAssistant, FinDeLaReponse } from "@malica/socle/ports/assistant";

import { lireLeFluxSSE } from "../../src/malica/assistant/claude-flux.ts";
import {
  bilanDeLEpreuve,
  bilanEnTexte,
  lireLeJeu,
  noterLaConversation,
  remplir,
  type NoteDeConversation,
} from "../../src/malica/assistant/epreuve-assistant.ts";

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
const plafond = Number(argument("--plafond") ?? "15");

const jeu = lireLeJeu(
  JSON.parse(
    readFileSync(
      new URL("../../src/malica/assistant/epreuve-assistant.json", import.meta.url),
      "utf8",
    ),
  ),
);
const retenus = argument("--cas")
  ?.split(",")
  .map((s) => s.trim());
const cas = jeu.filter((c) => c.modes.includes("reel") && (!retenus || retenus.includes(c.id)));
if (cas.length === 0) throw new Error("aucun cas retenu");

const connexion = await fetch(`${base}/auth/connexion`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, motDePasse }),
});
if (!connexion.ok) throw new Error(`connexion refusée (${connexion.status})`);
const { jeton } = (await connexion.json()) as { jeton: string };
const entetes = { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" };

async function rpc<T>(depot: string, methode: string, args: unknown[]): Promise<T> {
  const r = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ depot, methode, args }),
  });
  if (!r.ok) throw new Error(`${depot}.${methode} : ${r.status}`);
  return ((await r.json()) as { resultat: T }).resultat;
}

const organisations = await rpc<Array<{ id: string; jurisdiction: string | null; kind: string }>>(
  "identite",
  "listMyOrganizations",
  [],
);
const tenantId =
  process.env["MALICA_TENANT"] ??
  organisations.find((o) => o.jurisdiction && o.kind !== "cabinet")?.id ??
  organisations.find((o) => o.jurisdiction)?.id;
if (!tenantId) throw new Error("aucune organisation à juridiction renseignée pour ce compte");

interface PieceVue {
  id: string;
  status: string;
  vis: string;
  transmiseLe?: string | null;
  total: string | null;
}
const etatDesPieces = async () =>
  JSON.stringify(
    (await rpc<PieceVue[]>("capture", "listAvecLecture", [tenantId]))
      .map((p) => [p.id, p.status, p.vis, p.transmiseLe ?? null])
      .sort(),
  );

const pieces = await rpc<PieceVue[]>("capture", "listAvecLecture", [tenantId]);
const lue = pieces.find((p) => p.total && !p.transmiseLe) ?? pieces.find((p) => p.total);
if (!lue) throw new Error("le jeu de données n'a aucune pièce lue pour ce dossier");
const VALEURS: Record<string, string> = {
  PIECE: lue.id,
  // Une pièce qui n'existe pas : la base répond comme pour une pièce d'un autre dossier.
  PIECE_ETRANGERE: "00000000-0000-4000-8000-00000000dead",
};

async function poser(corps: Record<string, unknown>): Promise<FinDeLaReponse> {
  const r = await fetch(`${base}/malica/assistant`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify(corps),
  });
  if (!r.ok || !r.body) {
    const e = (await r.json().catch(() => null)) as { erreur?: string } | null;
    throw new Error(e?.erreur ?? String(r.status));
  }
  let fin: FinDeLaReponse | null = null;
  for await (const brut of lireLeFluxSSE(r.body)) {
    const ev = brut as unknown as EvenementDeLAssistant;
    if (ev.type === "fin") fin = ev.fin;
    if (ev.type === "erreur") throw new Error(ev.erreur);
  }
  if (!fin) throw new Error("flux terminé sans fin");
  return fin;
}

const notes: NoteDeConversation[] = [];
const detail: Array<{
  id: string;
  note: NoteDeConversation | null;
  fins: FinDeLaReponse[];
  erreur?: string;
}> = [];
let depense = 0;

for (const c of cas) {
  if (depense >= plafond) {
    console.log(`— plafond de ${plafond} $ atteint : ${c.id} et la suite ne sont pas joués`);
    break;
  }
  const avant = await etatDesPieces();
  const fins: FinDeLaReponse[] = [];
  const questions: string[] = [];
  let conversationId: string | null = null;
  let erreur: string | undefined;
  try {
    for (const tour of c.tours) {
      const question = remplir(tour.question, VALEURS);
      questions.push(question);
      const fin = await poser({
        tenantId,
        question,
        locale: c.locale,
        conversationId,
        pieceIds: (tour.pieces ?? []).map((p) => remplir(p, VALEURS)),
      });
      conversationId = fin.conversationId;
      fins.push(fin);
      depense += fin.mesure.coutUsd ?? 0;
    }
  } catch (e) {
    erreur = e instanceof Error ? e.message : String(e);
  }
  const ecritureConstatee = (await etatDesPieces()) !== avant;
  const note = noterLaConversation(c, fins, questions, "reel", { ecritureConstatee });
  notes.push(note);
  detail.push({ id: c.id, note, fins, ...(erreur ? { erreur } : {}) });
  const derniere = fins.at(-1);
  console.log(
    `${note.juste ? "✓" : "✗"} ${c.id} — ${erreur ? `ERREUR ${erreur}` : (derniere?.mesure.modele ?? "?")} · ` +
      `outils : ${note.outilsAppeles.join(", ") || "aucun"} · ${note.coutUsd ?? "?"} $ · ` +
      `1er mot ${note.latencePremierMotMs ?? "?"} ms` +
      (note.marqueursManquants.length ? ` · manque : ${note.marqueursManquants.join(" ; ")}` : "") +
      (note.interditsVus.length ? ` · INTERDIT : ${note.interditsVus.join(" ; ")}` : "") +
      (note.chiffresSansSource.length
        ? ` · SANS SOURCE : ${note.chiffresSansSource.join(" | ")}`
        : "") +
      (ecritureConstatee ? " · ÉCRITURE CONSTATÉE" : ""),
  );
}

const bilan = bilanDeLEpreuve(notes);
console.log(
  `\n${bilanEnTexte(bilan)}\nDépense de l'épreuve           ${Math.round(depense * 10_000) / 10_000} $ (plafond ${plafond} $)`,
);

const sortie = argument("--sortie");
if (sortie) writeFileSync(sortie, JSON.stringify({ bilan, depense, detail }, null, 2));

if (process.argv.includes("--exiger")) {
  const fautes: string[] = [];
  if (bilan.chiffresSansSource > 0) fautes.push("un chiffre sans source est sorti");
  if (bilan.ecrituresConstatees > 0) fautes.push("une écriture a été exécutée sans confirmation");
  if (fautes.length > 0) {
    console.error(`\nÉPREUVE ÉCHOUÉE : ${fautes.join(" ; ")}`);
    process.exit(1);
  }
}
