/**
 * Le client Claude du conseil cité — une interface, une implémentation HTTP.
 *
 * ============================================================ POURQUOI ISOLÉ
 *
 * La branche `claude/chaine-claude-deepseek` construit en parallèle son propre
 * client (`malica/lecture/claude.ts`) et la chaîne « Claude, puis DeepSeek,
 * puis l'arrêt ». Elle n'était pas poussée quand ce module a été écrit. Son
 * client ne sait envoyer qu'un texte et ne rend qu'un texte ; le conseil cité
 * a besoin de blocs `search_result` en entrée et des CITATIONS en sortie.
 *
 * D'où cette interface minuscule, `ClientClaude`, qui se branche sur l'un ou
 * l'autre : à la fusion, il suffit que le client de la chaîne sache envoyer
 * une `RequeteClaude` et rendre la réponse brute pour que le conseil cité
 * profite de son repli et de son compteur, sans toucher à `cite.ts`.
 *
 * Sans SDK, comme le client de la désignation : `fetch` suffit, et la forme de
 * l'appel se lit d'un coup d'œil. La clé est `ANTHROPIC_API_KEY`, côté
 * serveur seulement ; aucune épreuve n'appelle le réseau (le `fetch` est
 * injectable).
 */

import type { ReponseClaudeBrute, RequeteClaude } from "./cite.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
/** La version de l'API Messages : un en-tête stable, documenté par le fournisseur. */
const ANTHROPIC_VERSION = "2023-06-01";

class ErreurClaude extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ErreurClaude";
    this.status = status;
    this.retryable = retryable;
  }
}

export interface ClientClaude {
  envoyer(
    requete: RequeteClaude,
    options?: { signal?: AbortSignal },
  ): Promise<{
    reponse: ReponseClaudeBrute;
    latencyMs: number;
  }>;
}

export function clientClaudeHttp(input: {
  apiKey: string | undefined;
  fetch?: typeof fetch;
}): ClientClaude {
  return {
    async envoyer(requete, options) {
      const cle = input.apiKey?.trim();
      if (!cle) throw new ErreurClaude("ANTHROPIC_API_KEY absente", 401, false);

      const debut = Date.now();
      let res: Response;
      try {
        res = await (input.fetch ?? fetch)(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": cle,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(requete),
          ...(options?.signal ? { signal: options.signal } : {}),
        });
      } catch (cause) {
        throw new ErreurClaude(
          `Claude inatteignable : ${cause instanceof Error ? cause.message : String(cause)}`,
          503,
          true,
        );
      }
      const latencyMs = Date.now() - debut;
      const texte = await res.text();
      if (!res.ok) {
        // 429 (débit), 529 (surcharge) et 5xx sont passagers ; le reste ne l'est pas.
        const retryable = res.status === 429 || res.status >= 500;
        throw new ErreurClaude(
          `Claude ${res.status} : ${texte.slice(0, 300)}`,
          res.status,
          retryable,
        );
      }
      let reponse: ReponseClaudeBrute;
      try {
        reponse = JSON.parse(texte) as ReponseClaudeBrute;
      } catch {
        throw new ErreurClaude("réponse Claude illisible", 502, true);
      }
      if (reponse.stop_reason === "refusal") throw new ErreurClaude("Claude a refusé", 502, false);
      return { reponse, latencyMs };
    },
  };
}
