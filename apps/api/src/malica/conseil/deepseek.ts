/**
 * Malica — la voix. DeepSeek, et rien d'autre.
 *
 * R3 : Malica appelle, ne calcule pas. Ce module ne reçoit que des valeurs
 * déjà produites par le Socle ou lues en base, et interdit explicitement au
 * modèle d'en fabriquer de nouvelles. Aucune constante fiscale, aucun tarif :
 * les prix des jetons vivent dans `agents.model_pricing`.
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

// Les noms des modèles vivent dans `../modeles.ts`, avec la raison pour
// laquelle ils sont figés et le test qui les confronte à la table des tarifs.
import { DEEPSEEK_MODELS, type DeepSeekRole } from "../modeles.ts";

export type { DeepSeekRole };

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekResult {
  model: string;
  role: DeepSeekRole;
  answer: string;
  reasoning: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

export class DeepSeekError extends Error {
  // Champs déclarés puis affectés : Node décape les types sans compiler, et
  // une propriété de paramètre est la seule syntaxe qu'il ne sait pas effacer.
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function callDeepSeek(input: {
  apiKey: string;
  role: DeepSeekRole;
  messages: DeepSeekMessage[];
  /** Le raisonneur n'accepte ni température ni pénalités : on ne les envoie pas. */
  temperature?: number;
  signal?: AbortSignal;
  /**
   * `json` : le fournisseur garantit un objet JSON en sortie. L'invite doit
   * le demander aussi — le mode ne fait que l'imposer, il ne le décrit pas.
   */
  format?: "json";
}): Promise<DeepSeekResult> {
  const model = DEEPSEEK_MODELS[input.role];
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    stream: false,
  };
  if (input.role === "chat") {
    body["temperature"] = input.temperature ?? 0;
  }
  if (input.format === "json") {
    body["response_format"] = { type: "json_object" };
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (cause) {
    throw new DeepSeekError(
      `DeepSeek inatteignable : ${cause instanceof Error ? cause.message : String(cause)}`,
      503,
      true,
    );
  }

  const latencyMs = Date.now() - started;
  const text = await res.text();

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new DeepSeekError(
      `DeepSeek ${res.status} : ${text.slice(0, 500)}`,
      res.status,
      retryable,
    );
  }

  let parsed: {
    choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new DeepSeekError("réponse DeepSeek illisible", 502, true);
  }

  const choice = parsed.choices?.[0]?.message;
  const answer = (choice?.content ?? "").trim();
  if (!answer) throw new DeepSeekError("réponse DeepSeek vide", 502, true);

  return {
    model,
    role: input.role,
    answer,
    reasoning: choice?.reasoning_content?.trim() || null,
    tokensIn: parsed.usage?.prompt_tokens ?? null,
    tokensOut: parsed.usage?.completion_tokens ?? null,
    latencyMs,
  };
}
