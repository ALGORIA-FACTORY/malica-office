import "./lib/error-capture";

import { chargerLesEspaces } from "./i18n/dictionnaires";
import { consumeLastCapturedError } from "./lib/error-capture";
import { referenceDePanne, renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    // Le français se rend dès la première page : son dictionnaire — base et
    // espaces — se charge à la demande (`i18n/dictionnaires.ts`), et le
    // serveur l'attend avant de rendre quoi que ce soit.
    serverEntryPromise = Promise.all([
      import("@tanstack/react-start/server-entry"),
      chargerLesEspaces("fr"),
    ]).then(([m]) => (m.default ?? m) as ServerEntry);
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  // The reference shown on the page leads the log line: the person quotes it.
  const ref = referenceDePanne();
  console.error(
    `[ssr ref ${ref}]`,
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  );
  return new Response(renderErrorPage(ref), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      const ref = referenceDePanne();
      console.error(`[ssr ref ${ref}]`, error);
      return new Response(renderErrorPage(ref), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
