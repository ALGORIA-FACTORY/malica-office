/**
 * La durée d'un appel au modèle court jusqu'à la fin de sa réponse.
 *
 * Relevé le 10 novembre 2026 sur le staging : le journal des agents notait
 * 463 ms en moyenne pour des réponses reçues en 6 à 15 secondes. La durée
 * était prise à l'arrivée des en-têtes, avant la lecture du corps.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { callDeepSeek } from "./deepseek.ts";

const CORPS_LENT_MS = 120;

describe("la durée journalisée d'un appel DeepSeek", () => {
  let fetchOriginal: typeof fetch;
  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    // Les en-têtes arrivent tout de suite ; le corps, lui, met son temps.
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((resoudre) =>
            setTimeout(
              () =>
                resoudre(
                  JSON.stringify({
                    model: "modele-d-essai",
                    choices: [{ message: { content: "Bonjour." } }],
                    usage: { prompt_tokens: 3, completion_tokens: 2 },
                  }),
                ),
              CORPS_LENT_MS,
            ),
          ),
      }) as unknown as Response) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("compte le temps de lecture du corps", async () => {
    const r = await callDeepSeek({
      apiKey: "cle-d-essai",
      role: "chat",
      messages: [{ role: "user", content: "Bonjour" }],
    });
    assert.ok(
      r.latencyMs >= CORPS_LENT_MS - 5,
      `durée journalisée ${r.latencyMs} ms pour un corps reçu en ${CORPS_LENT_MS} ms`,
    );
  });
});
