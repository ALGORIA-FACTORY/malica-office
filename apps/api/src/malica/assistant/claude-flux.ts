/**
 * Claude en flux — l'API Messages avec `stream: true`, sans SDK.
 *
 * ================================================================ LE FLUX
 *
 * Les événements sont ceux de la documentation « Streaming Messages »
 * (relevée le 8 novembre 2026) : `message_start`, puis par bloc
 * `content_block_start` / `content_block_delta` / `content_block_stop`, puis
 * `message_delta` (raison d'arrêt, usage cumulé) et `message_stop`. Les
 * deltas sont `text_delta`, `input_json_delta` (l'entrée d'un outil, en JSON
 * partiel à recoller), `citations_delta` (une citation à ajouter au bloc de
 * texte courant), `thinking_delta` et `signature_delta`. `ping` peut venir
 * n'importe quand ; un événement inconnu s'ignore.
 *
 * ============================================================ L'ASSEMBLEUR
 *
 * `Assembleur` recompose le message entier à partir des événements, pour
 * qu'on puisse le RENVOYER tel quel au tour suivant de la boucle d'outils :
 * un bloc `thinking` doit revenir avec sa signature, un `tool_use` avec son
 * entrée complète. Il est pur, et c'est lui que les épreuves nourrissent.
 *
 * La clé est `ANTHROPIC_API_KEY`, côté serveur seulement ; aucune épreuve
 * n'appelle le réseau (le `fetch` est injectable).
 */

import { ANTHROPIC_URL, ANTHROPIC_VERSION } from "../lecture/claude.ts";

class ErreurDeFlux extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ErreurDeFlux";
    this.status = status;
    this.retryable = retryable;
  }
}

/** Un événement du flux, tel que l'API l'envoie (champs lus seulement). */
export interface EvenementClaude {
  type: string;
  index?: number;
  message?: { model?: string; usage?: UsageBrut };
  content_block?: BlocBrut;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
    signature?: string;
    citation?: Record<string, unknown>;
    stop_reason?: string | null;
  };
  usage?: UsageBrut;
  error?: { type?: string; message?: string };
}

interface UsageBrut {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Un bloc de contenu, tel qu'on le renvoie au tour suivant. */
export type BlocBrut =
  | { type: "text"; text: string; citations?: Array<Record<string, unknown>> | null }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: string; [cle: string]: unknown };

export interface MessageAssemble {
  model: string | null;
  content: BlocBrut[];
  stopReason: string | null;
  usage: { entree: number; sortie: number; cacheLu: number; cacheEcrit: number };
}

/**
 * Recompose un message à partir des événements du flux. Les entrées d'outil
 * arrivent en JSON partiel : elles se recollent et se lisent à la fin du bloc.
 */
export class Assembleur {
  private model: string | null = null;
  private readonly blocs: Array<BlocBrut & { _json?: string }> = [];
  private stopReason: string | null = null;
  private usage = { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 };

  recevoir(ev: EvenementClaude): void {
    switch (ev.type) {
      case "message_start": {
        this.model = ev.message?.model ?? null;
        this.lireUsage(ev.message?.usage);
        return;
      }
      case "content_block_start": {
        const b = ev.content_block;
        if (!b || typeof ev.index !== "number") return;
        if (b.type === "tool_use") {
          this.blocs[ev.index] = { ...b, input: {}, _json: "" } as BlocBrut & { _json: string };
        } else if (b.type === "text") {
          this.blocs[ev.index] = { type: "text", text: "", citations: [] };
        } else if (b.type === "thinking") {
          this.blocs[ev.index] = { type: "thinking", thinking: "", signature: "" };
        } else {
          this.blocs[ev.index] = { ...b };
        }
        return;
      }
      case "content_block_delta": {
        const b = typeof ev.index === "number" ? this.blocs[ev.index] : undefined;
        const d = ev.delta;
        if (!b || !d) return;
        if (d.type === "text_delta" && b.type === "text") {
          (b as { text: string }).text += d.text ?? "";
        } else if (d.type === "input_json_delta") {
          b._json = (b._json ?? "") + (d.partial_json ?? "");
        } else if (d.type === "citations_delta" && b.type === "text" && d.citation) {
          const t = b as { citations?: Array<Record<string, unknown>> | null };
          (t.citations ??= []).push(d.citation);
        } else if (d.type === "thinking_delta" && b.type === "thinking") {
          (b as { thinking: string }).thinking += d.thinking ?? "";
        } else if (d.type === "signature_delta" && b.type === "thinking") {
          (b as { signature: string }).signature += d.signature ?? "";
        }
        return;
      }
      case "content_block_stop": {
        const b = typeof ev.index === "number" ? this.blocs[ev.index] : undefined;
        if (b?.type === "tool_use") {
          const brut = b._json?.trim() ?? "";
          let entree: unknown = {};
          try {
            entree = brut ? JSON.parse(brut) : {};
          } catch {
            // Une entrée illisible n'est pas une panne du flux : l'outil la
            // refusera avec un message, et le modèle se corrigera.
            entree = { _illisible: brut.slice(0, 200) };
          }
          (b as { input: unknown }).input = entree;
          delete b._json;
        }
        return;
      }
      case "message_delta": {
        if (ev.delta?.stop_reason !== undefined) this.stopReason = ev.delta.stop_reason ?? null;
        this.lireUsage(ev.usage);
        return;
      }
      case "error": {
        throw new ErreurDeFlux(
          `Claude : ${ev.error?.type ?? "erreur"} ${ev.error?.message ?? ""}`.trim(),
          ev.error?.type === "overloaded_error" ? 529 : 500,
          true,
        );
      }
      default:
        return;
    }
  }

  /** L'usage est cumulé dans `message_delta` : on garde le plus grand vu. */
  private lireUsage(u: UsageBrut | undefined): void {
    if (!u) return;
    this.usage = {
      entree: Math.max(this.usage.entree, u.input_tokens ?? 0),
      sortie: Math.max(this.usage.sortie, u.output_tokens ?? 0),
      cacheLu: Math.max(this.usage.cacheLu, u.cache_read_input_tokens ?? 0),
      cacheEcrit: Math.max(this.usage.cacheEcrit, u.cache_creation_input_tokens ?? 0),
    };
  }

  message(): MessageAssemble {
    return {
      model: this.model,
      content: this.blocs.filter(Boolean).map((b) => {
        const { _json, ...reste } = b as BlocBrut & { _json?: string };
        void _json;
        return reste as BlocBrut;
      }),
      stopReason: this.stopReason,
      usage: { ...this.usage },
    };
  }
}

/** Lit un flux SSE (`event:` / `data:`) et rend chaque `data` décodé. */
export async function* lireLeFluxSSE(
  corps: ReadableStream<Uint8Array>,
): AsyncGenerator<EvenementClaude> {
  const lecteur = corps.getReader();
  const decodeur = new TextDecoder();
  let tampon = "";
  for (;;) {
    const { value, done } = await lecteur.read();
    if (value) tampon += decodeur.decode(value, { stream: true });
    let fin: number;
    while ((fin = tampon.search(/\r?\n\r?\n/)) >= 0) {
      const brut = tampon.slice(0, fin);
      tampon = tampon.slice(fin).replace(/^\r?\n\r?\n/, "");
      const donnees = brut
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!donnees) continue;
      try {
        yield JSON.parse(donnees) as EvenementClaude;
      } catch {
        // Une ligne illisible ne casse pas la conversation : on la saute.
      }
    }
    if (done) return;
  }
}

/** Ce que la boucle d'outils appelle : une requête, un flux d'événements. */
export type ClientEnFlux = (
  requete: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => AsyncIterable<EvenementClaude>;

export function clientClaudeEnFlux(input: {
  apiKey: string | undefined;
  fetch?: typeof fetch;
}): ClientEnFlux {
  return async function* (requete, options) {
    const cle = input.apiKey?.trim();
    if (!cle) throw new ErreurDeFlux("ANTHROPIC_API_KEY absente", 401, false);
    let res: Response;
    try {
      res = await (input.fetch ?? fetch)(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cle,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({ ...requete, stream: true }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      throw new ErreurDeFlux(
        `Claude inatteignable : ${cause instanceof Error ? cause.message : String(cause)}`,
        503,
        true,
      );
    }
    if (!res.ok || !res.body) {
      const texte = await res.text().catch(() => "");
      // 429 (débit), 529 (surcharge) et 5xx sont passagers ; le reste ne l'est pas.
      const retryable = res.status === 429 || res.status >= 500;
      throw new ErreurDeFlux(
        `Claude ${res.status} : ${texte.slice(0, 300)}`,
        res.status,
        retryable,
      );
    }
    yield* lireLeFluxSSE(res.body);
  };
}
