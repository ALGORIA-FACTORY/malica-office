/**
 * Verification of PR #298 — defects found by execution.
 *
 * 1. Section 11 ("the accounting firm's review queue"): on main, a PME's
 *    dossier-specific tax question asked in "Parler a Malica" goes through
 *    `askMalica`, is RETAINED and lands in the firm's review queue
 *    (`conseil.creer`). After #298 the PME screen (and the cabinet's
 *    MalicaChat) call `/malica/assistant` only; when Claude answers, nothing
 *    reaches the queue: no `conseil.creer`, no certainty/doubt/theme, no
 *    controls. The same question through `/malica/demander` (the path main
 *    used) does reach it — that half is the control and passes.
 *
 * 2. An unsourced figure removed by the guard still travels to the browser,
 *    in the `retire` event and in `fin.chiffresRetires`.
 *
 * The Anthropic and DeepSeek endpoints are simulated (fetch is replaced);
 * nothing leaves the machine.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { emettreJeton } from "../../auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "../../circuit-d-essai.ts";

const QUESTION =
  "Ma société doit-elle appliquer la retenue à la source sur le loyer de notre local ?";

describe("#298 — the assistant and the firm's review queue", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let base = "";
  let jeton = "";
  let arret: (() => Promise<void>) | null = null;
  const vraiFetch = globalThis.fetch;

  before(async () => {
    process.env["STOCKAGE_RACINE"] = await mkdtemp(path.join(tmpdir(), "file-assistant-"));
    process.env["ANTHROPIC_API_KEY"] = "simulated-not-a-key";
    process.env["DEEPSEEK_API_KEY"] = "simulated-not-a-key";
    delete process.env["QWEN_API_KEY"];
    s = await monterUneSociete(`file-assistant-${Date.now()}`);
    jeton = emettreJeton(s.gens.amel, new Date());

    const sse = (evs: Array<Record<string, unknown>>) =>
      new Response(
        evs.map((e) => `event: ${String(e["type"])}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.startsWith("http://127.0.0.1")) return vraiFetch(url, init);
      if (u.includes("anthropic.com")) {
        return sse([
          {
            type: "message_start",
            message: { model: "claude-haiku-4-5", usage: { input_tokens: 10, output_tokens: 1 } },
          },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: "Oui, votre société doit retenir à la source sur ce loyer. Vous devrez aussi 4321 dinars de pénalités. ",
            },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 20 },
          },
          { type: "message_stop" },
        ]);
      }
      if (u.includes("deepseek.com")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    reponse: "Oui, votre société doit retenir à la source sur ce loyer.",
                    conseil: true,
                    portee: "dossier",
                    theme: "retenue_a_la_source",
                    certitude: 0.4,
                    sources: [],
                    doute: "Le régime du bailleur n'est pas connu.",
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }
      return new Response("blocked", { status: 503 });
    }) as typeof fetch;

    const { app } = await import("../../app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));
  });

  after(async () => {
    globalThis.fetch = vraiFetch;
    await arret?.();
    await s.fermer();
  });

  const fileDuCabinet = async () =>
    ((await s.fait("expert", "conseil.file", s.cabinet)) as unknown[]).length;

  const poser = (route: string, corps: Record<string, unknown>) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: JSON.stringify({ tenantId: s.pme, question: QUESTION, locale: "fr", ...corps }),
    });

  it("control: through /malica/demander (main's path), the question reaches the firm's queue", async () => {
    const avant = await fileDuCabinet();
    const r = await poser("/malica/demander", { mode: "chat" });
    assert.equal(r.status, 200, await r.clone().text());
    const corps = (await r.json()) as { retenue: boolean; answer: string };
    // Mode "annoncer": the answer is shown and announced, no longer withheld.
    assert.equal(corps.retenue, false);
    assert.ok(corps.answer.includes("doit retenir à la source"), "the answer was withheld");
    assert.ok(corps.answer.includes("confirmer par votre comptable"), "not announced");
    assert.equal(await fileDuCabinet(), avant + 1);
  });

  it("through /malica/assistant (the PME screen after #298), the same question reaches the firm's queue too", async () => {
    const avant = await fileDuCabinet();
    const r = await poser("/malica/assistant", {});
    assert.equal(r.status, 200);
    const corps = await r.text();
    assert.equal(
      await fileDuCabinet(),
      avant + 1,
      "the assistant answered a dossier-specific tax question itself; the firm never sees it",
    );
    // Decision of 11 November 2026 (mode "annoncer", delivered in base): the
    // PME reads the answer itself, marked, instead of the review message.
    assert.ok(corps.includes("doit retenir à la source"), "the answer was withheld");
    assert.ok(corps.includes("confirmer par votre comptable"), "the review was not announced");
    assert.ok(!corps.includes("relit ma réponse"), "the review message replaced the answer");
  });

  it("a figure the guard removed never reaches the browser", async () => {
    const r = await poser("/malica/assistant", { question: "Dois-je payer quelque chose ?" });
    const corps = await r.text();
    assert.ok(corps.includes("event: fin"));
    assert.ok(
      !corps.includes("4321"),
      "the removed sentence travels in the payload (retire / chiffresRetires)",
    );
  });
});
