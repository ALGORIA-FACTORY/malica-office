/**
 * Claude — le désignateur principal (décision du dirigeant, 8 novembre 2026).
 *
 * Un client HTTP de l'API Messages, sans SDK : une dépendance de plus pour un
 * seul appel n'apporterait rien que `fetch` n'ait déjà, et la forme de l'appel
 * se lit ici d'un coup d'œil.
 *
 * Ce module ne choisit PAS le modèle : il reçoit son nom de la chaîne réglée
 * par la tour (`plateforme.reglages_designation`), qui ne peut nommer qu'un
 * modèle tarifé en base (R8). Il ne porte ni tarif ni plafond : le coût se
 * calcule au journal (`agents_run_log`), le plafond se lit dans la chaîne.
 *
 * La clé est `ANTHROPIC_API_KEY`, côté serveur seulement. Absente, l'appel
 * échoue comme une panne — et la chaîne passe au repli : c'est un défaut
 * technique, pas une raison de s'arrêter.
 */

/** L'adresse de l'API Messages — la seule, partagée par la lecture et l'assistant. */
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
/** La version de l'API Messages : un en-tête stable, documenté par le fournisseur. */
export const ANTHROPIC_VERSION = "2023-06-01";
/*
 * La désignation rend une vingtaine de `page/ordinal` : une sortie courte. La
 * borne couvre la réflexion du modèle, qui compte dans `max_tokens`.
 */
const SORTIE_MAX_JETONS = 8192;
/*
 * L'effort de réflexion. Quelqu'un attend sa lecture, téléphone en main : la
 * documentation conseille `low` ou `medium` pour le travail sensible à la
 * latence. Le moteur Sudoku vérifie derrière, et la relecture dans le plan
 * (R2) n'accepte de toute façon aucune valeur du modèle.
 */
const EFFORT = "low";

export class ClaudeError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ClaudeError";
    this.status = status;
    this.retryable = retryable;
  }
}

export interface ClaudeResult {
  model: string;
  answer: string;
  /** Les jetons d'entrée HORS cache (après le point de cache) : le tarif `chat`. */
  tokensIn: number | null;
  tokensOut: number | null;
  /** Le cache du prompt système : lu (tarif `cache`) et écrit (tarif `cache_ecriture`). */
  cache: { lus: number | null; ecrits: number | null };
  latencyMs: number;
}

/**
 * L'appel HTTP à l'API Messages, et rien d'autre : la clé, l'envoi, les pannes
 * classées (passagère ou non), la réponse lue. Un seul transport pour tout ce
 * qui parle à Claude — la désignation (`callClaude`) et le conseil cité
 * (`malica/conseil/client-claude.ts`) : le corps de la requête est à eux.
 */
export async function envoyerAClaude<R extends { stop_reason?: string | null }>(input: {
  apiKey: string | undefined;
  corps: unknown;
  signal?: AbortSignal;
  /** Injectable pour les épreuves : aucune épreuve n'appelle le réseau. */
  fetch?: typeof fetch;
}): Promise<{ reponse: R; latencyMs: number }> {
  const cle = input.apiKey?.trim();
  if (!cle) throw new ClaudeError("ANTHROPIC_API_KEY absente", 401, false);

  const started = Date.now();
  let res: Response;
  try {
    res = await (input.fetch ?? fetch)(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cle,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(input.corps),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (cause) {
    // Un délai dépassé garde son nom : la chaîne le reconnaît comme une panne.
    if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError"))
      throw cause;
    throw new ClaudeError(
      `Claude inatteignable : ${cause instanceof Error ? cause.message : String(cause)}`,
      503,
      true,
    );
  }

  const latencyMs = Date.now() - started;
  const text = await res.text();
  if (!res.ok) {
    // 429 (débit), 529 (surcharge) et 5xx sont passagers ; le reste ne l'est pas.
    const retryable = res.status === 429 || res.status >= 500;
    throw new ClaudeError(`Claude ${res.status} : ${text.slice(0, 300)}`, res.status, retryable);
  }

  let reponse: R;
  try {
    reponse = JSON.parse(text) as R;
  } catch {
    throw new ClaudeError("réponse Claude illisible", 502, true);
  }
  if (reponse.stop_reason === "refusal") throw new ClaudeError("Claude a refusé", 502, false);
  return { reponse, latencyMs };
}

export async function callClaude(input: {
  apiKey: string | undefined;
  model: string;
  system: string;
  user: string;
  signal?: AbortSignal;
  /** Injectable pour les épreuves : aucune épreuve n'appelle le réseau. */
  fetch?: typeof fetch;
}): Promise<ClaudeResult> {
  const { reponse: parsed, latencyMs } = await envoyerAClaude<{
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  }>({
    apiKey: input.apiKey,
    corps: {
      model: input.model,
      max_tokens: SORTIE_MAX_JETONS,
      output_config: { effort: EFFORT },
      /*
       * LE PROMPT SYSTÈME SE MET EN CACHE. Il est le même pour chaque pièce
       * (le dossier, les tiers et le plan voyagent dans le message) : lu en
       * cache, il coûte 0,05 à 0,1 fois le prix d'entrée. Le point de cache
       * est posé à sa fin ; le cache vit cinq minutes, renouvelé à chaque
       * lecture. Trop court, il n'est simplement pas mis en cache.
       */
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input.user }],
    },
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });

  const answer = (parsed.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!answer) throw new ClaudeError("réponse Claude vide", 502, true);

  return {
    model: input.model,
    answer,
    tokensIn: parsed.usage?.input_tokens ?? null,
    tokensOut: parsed.usage?.output_tokens ?? null,
    cache: {
      lus: parsed.usage?.cache_read_input_tokens ?? null,
      ecrits: parsed.usage?.cache_creation_input_tokens ?? null,
    },
    latencyMs,
  };
}
