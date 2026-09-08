/**
 * Malica rédige — depuis des faits, jamais depuis sa mémoire.
 *
 * ============================================================== POURQUOI
 *
 * Un briefing de transfert, un procès-verbal, un message au client : le
 * texte est d'elle, mais chaque nombre vient d'un moteur du Socle. Ce module
 * est le seul chemin vers le modèle pour ces rédactions, et il tient la
 * promesse mécaniquement : le modèle reçoit la liste des faits, et le texte
 * rendu est relu avec `chiffresEngageants` — un nombre qui n'est dans aucun
 * fait fait rejeter le texte. Une reprise, puis l'échec, jamais l'à-peu-près.
 */
import { chiffresEngageants } from "./controles.ts";
import { callDeepSeek } from "./deepseek.ts";
import type { Fait } from "@malica/socle/ports/malica";

export interface Redaction {
  texte: string;
  /** Les faits, tels qu'ils ont été fournis : l'écran les affiche avec leur source. */
  faits: Fait[];
  modele: string;
}

/** Le délai au-delà duquel une rédaction n'a plus de valeur pour la personne qui attend. */
const DELAI_MS = 120_000;

function tonEnMots(ton: string, langue: string): string {
  if (langue.startsWith("ar")) return ton === "chaleureux" ? "ودود ومباشر" : "رصين ودقيق";
  if (langue.startsWith("en"))
    return ton === "chaleureux" ? "warm and direct" : "sober and precise";
  return ton === "chaleureux" ? "chaleureux et direct" : "sobre et précis";
}

/** Les nombres qu'un texte a le droit de porter : ceux des faits, et eux seuls. */
export function nombresAutorises(faits: readonly Fait[]): Set<string> {
  const autorises = new Set<string>();
  for (const f of faits) {
    for (const n of chiffresEngageants(`${f.label} ${f.valeur}`)) autorises.add(n);
  }
  return autorises;
}

/** Les nombres du texte qui ne viennent d'aucun fait. */
export function nombresEtrangers(texte: string, faits: readonly Fait[]): string[] {
  const autorises = nombresAutorises(faits);
  return chiffresEngageants(texte).filter((n) => !autorises.has(n));
}

export async function redigerDepuisLesFaits(params: {
  consigne: string;
  faits: Fait[];
  ton: string;
  langue: string;
  signal?: AbortSignal;
}): Promise<Redaction> {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("redaction.indisponible");

  const listeDesFaits = params.faits
    .map((f) => `- ${f.label} : ${f.valeur} (source : ${f.source})`)
    .join("\n");
  const systeme = [
    "Tu es Malica, l'assistante d'un cabinet d'expertise comptable.",
    `Tu rédiges en ${params.langue.startsWith("ar") ? "arabe" : params.langue.startsWith("en") ? "anglais" : "français"}, sur un ton ${tonEnMots(params.ton, params.langue)}.`,
    "Règle absolue : tu ne peux écrire QUE les nombres qui figurent dans la liste des faits, exactement tels qu'ils y sont écrits. Aucun autre nombre, aucune date, aucun montant, aucun pourcentage, aucune estimation.",
    "Si un fait manque pour dire quelque chose, tu dis que tu ne le sais pas.",
    "Pas de titres, pas de listes à puces, pas de mise en forme : des phrases courtes, en paragraphes.",
  ].join("\n");

  const messages = [
    { role: "system" as const, content: systeme },
    { role: "user" as const, content: `${params.consigne}\n\nLes faits :\n${listeDesFaits}` },
  ];

  let dernierTexte = "";
  for (let essai = 0; essai < 2; essai += 1) {
    const signal = params.signal ?? AbortSignal.timeout(DELAI_MS);
    const resultat = await callDeepSeek({
      apiKey,
      role: "chat",
      temperature: 0.3,
      signal,
      messages:
        essai === 0
          ? messages
          : [
              ...messages,
              { role: "assistant" as const, content: dernierTexte },
              {
                role: "user" as const,
                content:
                  "Ton texte contient des nombres absents de la liste des faits. Réécris-le en n'utilisant que les nombres de la liste, sans en ajouter aucun.",
              },
            ],
    });
    dernierTexte = resultat.answer.trim();
    if (nombresEtrangers(dernierTexte, params.faits).length === 0) {
      return { texte: dernierTexte, faits: params.faits, modele: resultat.model };
    }
  }
  throw new Error("redaction.chiffre_etranger");
}
