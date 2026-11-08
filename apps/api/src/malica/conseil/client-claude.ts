/**
 * Le client Claude du conseil cité — une interface, branchée sur le transport
 * commun (`malica/lecture/claude.ts`, `envoyerAClaude`).
 *
 * Le conseil cité a besoin de blocs `search_result` en entrée et des
 * CITATIONS en sortie : il compose sa requête (`cite.ts`) et lit la réponse
 * brute. L'envoi, la clé (`ANTHROPIC_API_KEY`, côté serveur seulement) et le
 * classement des pannes sont ceux de la désignation — un seul client HTTP
 * pour tout ce qui parle à Claude (nettoyage du 8 novembre 2026). Aucune
 * épreuve n'appelle le réseau : le `fetch` est injectable.
 */

import { envoyerAClaude } from "../lecture/claude.ts";
import type { ReponseClaudeBrute, RequeteClaude } from "./cite.ts";

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
    envoyer: (requete, options) =>
      envoyerAClaude<ReponseClaudeBrute>({
        apiKey: input.apiKey,
        corps: requete,
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      }),
  };
}
