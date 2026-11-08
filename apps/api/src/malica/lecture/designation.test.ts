/**
 * La chaîne de désignation : Claude, puis DeepSeek, puis l'arrêt.
 *
 * Décision du dirigeant du 8 novembre 2026. Éprouvée SANS RÉSEAU : `fetch`
 * est remplacé, pour tout le fichier, par une fonction qui échoue — un appel
 * payant réel ferait tomber l'épreuve au lieu de passer en silence. Les
 * maillons sont des fonctions injectées qui comptent leurs appels.
 *
 *   node --experimental-strip-types --test src/malica/lecture/designation.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { callClaude, ClaudeError } from "./claude.ts";
import {
  designerEnChaine,
  erreurAuJournal,
  lireLaChaine,
  type MaillonDeDesignation,
  type ReponseDeDesignation,
} from "./designation.ts";
import { entreesDuJournal } from "./read-flow.ts";
import type { PageToken } from "./token-plan.ts";
import { runVisionRead } from "./vision.ts";

const FETCH_D_ORIGINE = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => {
    throw new Error("appel réseau interdit dans cette épreuve");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = FETCH_D_ORIGINE;
});

function maillon(
  rang: number,
  fournisseur: "anthropic" | "deepseek",
  epuise = false,
): MaillonDeDesignation {
  return {
    rang,
    fournisseur,
    modele: fournisseur === "anthropic" ? "claude-sonnet-5-5" : "deepseek-chat",
    role: "chat",
    periode: "mois",
    plafond: 50,
    depense: epuise ? 50 : 0,
    epuise,
  };
}

const REPONSE: ReponseDeDesignation = {
  answer: "{}",
  tokensIn: 1000,
  tokensOut: 50,
  latencyMs: 10,
};

/** Des maillons qui répondent, ou qui tombent, et qui comptent leurs appels. */
function appelant(pannes: ReadonlySet<string>) {
  const appels: string[] = [];
  return {
    appels,
    appeler: async (m: MaillonDeDesignation) => {
      appels.push(m.fournisseur);
      if (pannes.has(m.fournisseur)) throw new Error(`${m.fournisseur} 529 : surcharge`);
      return { ...REPONSE, answer: `{"par":"${m.fournisseur}"}` };
    },
  };
}

describe("la chaîne de désignation", () => {
  it("Claude répond : il désigne, DeepSeek n'est pas appelé", async () => {
    const a = appelant(new Set());
    const r = await designerEnChaine({
      chaine: [maillon(2, "deepseek"), maillon(1, "anthropic")],
      appeler: a.appeler,
    });
    assert.equal(r.issue, "designee");
    assert.equal(r.issue === "designee" && r.maillon.fournisseur, "anthropic");
    assert.deepEqual(r.bascules, []);
    assert.deepEqual(a.appels, ["anthropic"], "l'ordre est celui des rangs, pas de la liste");
  });

  it("Claude en panne : DeepSeek prend la main, et la bascule est dite « technique »", async () => {
    const a = appelant(new Set(["anthropic"]));
    const r = await designerEnChaine({
      chaine: [maillon(1, "anthropic"), maillon(2, "deepseek")],
      appeler: a.appeler,
    });
    assert.equal(r.issue, "designee");
    assert.equal(r.issue === "designee" && r.maillon.fournisseur, "deepseek");
    assert.deepEqual(a.appels, ["anthropic", "deepseek"]);
    assert.equal(r.bascules.length, 1);
    assert.equal(r.bascules[0]!.motif, "technique");
    assert.equal(r.bascules[0]!.modele, "claude-sonnet-5-5");
    assert.match(r.bascules[0]!.detail ?? "", /529/);
    assert.match(erreurAuJournal(r.bascules[0]!, null), /^bascule\.technique: /);
  });

  it("budget de Claude épuisé : Claude n'est PAS appelé, DeepSeek désigne (« budget »)", async () => {
    const a = appelant(new Set());
    const r = await designerEnChaine({
      chaine: [maillon(1, "anthropic", true), maillon(2, "deepseek")],
      appeler: a.appeler,
    });
    assert.equal(r.issue === "designee" && r.maillon.fournisseur, "deepseek");
    assert.deepEqual(a.appels, ["deepseek"], "un budget épuisé ne se dépense pas");
    assert.deepEqual(
      r.bascules.map((b) => [b.fournisseur, b.motif]),
      [["anthropic", "budget"]],
    );
    assert.equal(erreurAuJournal(r.bascules[0]!, null), "bascule.budget");
  });

  it("les deux budgets épuisés : on s'arrête, sans aucun appel", async () => {
    const a = appelant(new Set());
    const r = await designerEnChaine({
      chaine: [maillon(1, "anthropic", true), maillon(2, "deepseek", true)],
      appeler: a.appeler,
    });
    assert.equal(r.issue, "arretee");
    assert.equal(r.issue === "arretee" && r.motif, "arret.budgets_epuises");
    assert.deepEqual(a.appels, [], "aucun fournisseur appelé, ni un troisième");
    assert.deepEqual(
      r.bascules.map((b) => b.motif),
      ["budget", "budget"],
    );
    assert.equal(erreurAuJournal(r.bascules[0]!, "arret.budgets_epuises"), "arret.budgets_epuises");
  });

  it("les deux en panne : la panne remonte (la file rejouera), ce n'est pas un arrêt", async () => {
    const a = appelant(new Set(["anthropic", "deepseek"]));
    await assert.rejects(
      designerEnChaine({
        chaine: [maillon(1, "anthropic"), maillon(2, "deepseek")],
        appeler: a.appeler,
      }),
      /deepseek 529/,
    );
    assert.deepEqual(a.appels, ["anthropic", "deepseek"]);
  });

  it("Claude épuisé et DeepSeek en panne : la panne remonte", async () => {
    const a = appelant(new Set(["deepseek"]));
    await assert.rejects(
      designerEnChaine({
        chaine: [maillon(1, "anthropic", true), maillon(2, "deepseek")],
        appeler: a.appeler,
      }),
      /deepseek 529/,
    );
    assert.deepEqual(a.appels, ["deepseek"]);
  });

  it("une chaîne vide s'arrête, et le dit", async () => {
    const r = await designerEnChaine({ chaine: [], appeler: appelant(new Set()).appeler });
    assert.equal(r.issue === "arretee" && r.motif, "arret.chaine_vide");
  });

  it("la chaîne de la base ne peut nommer que les deux fournisseurs que le serveur sait appeler", () => {
    const brute = [
      {
        rang: 1,
        fournisseur: "anthropic",
        modele: "claude-sonnet-5-5",
        role: "chat",
        periode: "mois",
        plafond: 50,
        depense: 0,
        epuise: false,
      },
    ];
    assert.equal(lireLaChaine(brute)[0]!.fournisseur, "anthropic");
    assert.throws(
      () => lireLaChaine([{ ...brute[0], fournisseur: "openai" }]),
      /designation\.chaine_illisible/,
    );
    assert.throws(() => lireLaChaine(null), /designation\.chaine_illisible/);
  });
});

/* ------------------------------------------------------------ LE CLIENT CLAUDE */

describe("le client Claude", () => {
  it("sans clé, il échoue comme une panne, sans rien envoyer", async () => {
    let appele = false;
    await assert.rejects(
      callClaude({
        apiKey: undefined,
        model: "claude-sonnet-5-5",
        system: "s",
        user: "u",
        fetch: (async () => {
          appele = true;
          return new Response("{}");
        }) as typeof fetch,
      }),
      (e: unknown) => e instanceof ClaudeError && e.status === 401 && !e.retryable,
    );
    assert.equal(appele, false);
  });

  it("envoie le modèle de la chaîne à l'API Messages, et lit texte et jetons", async () => {
    let requete: { url: string; init: RequestInit } | null = null;
    const r = await callClaude({
      apiKey: "cle-d-essai",
      model: "claude-haiku-5-5",
      system: "le système",
      user: "le plan",
      fetch: (async (url: string, init: RequestInit) => {
        requete = { url, init };
        return new Response(
          JSON.stringify({
            content: [
              { type: "thinking", thinking: "…" },
              { type: "text", text: '{"issuer":' },
              { type: "text", text: "null}" },
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 1234, output_tokens: 56 },
          }),
        );
      }) as unknown as typeof fetch,
    });
    assert.equal(r.answer, '{"issuer":null}', "seuls les blocs de texte, dans l'ordre");
    assert.equal(r.tokensIn, 1234);
    assert.equal(r.tokensOut, 56);
    assert.ok(requete);
    const { url, init } = requete as { url: string; init: RequestInit };
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const entetes = init.headers as Record<string, string>;
    assert.equal(entetes["x-api-key"], "cle-d-essai");
    assert.ok(entetes["anthropic-version"]);
    const corps = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.equal(corps["model"], "claude-haiku-5-5", "le modèle vient de la chaîne");
    assert.equal(corps["system"], "le système");
    assert.deepEqual(corps["messages"], [{ role: "user", content: "le plan" }]);
  });

  it("une surcharge (529) est une panne passagère", async () => {
    await assert.rejects(
      callClaude({
        apiKey: "k",
        model: "claude-sonnet-5-5",
        system: "s",
        user: "u",
        fetch: (async () =>
          new Response('{"type":"error"}', { status: 529 })) as unknown as typeof fetch,
      }),
      (e: unknown) => e instanceof ClaudeError && e.status === 529 && e.retryable,
    );
  });
});

/* ------------------------------------------------- LA CHAÎNE DANS LA LECTURE */

/** Un plan de jetons minimal, déjà relevé : la passe 1 ne part pas. */
const PLAN: PageToken[] = ["FACTURE", "SOCIETE", "TOTAL", "118,000"].map((text, ordinal) => ({
  page: 1,
  ordinal,
  text,
  x0: 0.1,
  y0: 0.1 + ordinal * 0.1,
  x1: 0.4,
  y1: 0.15 + ordinal * 0.1,
})) as PageToken[];

function lire(chaine: MaillonDeDesignation[], pannes: ReadonlySet<string>) {
  const a = appelant(pannes);
  return {
    appels: a.appels,
    lecture: runVisionRead({
      dataUrl: "data:image/png;base64,",
      tokens: PLAN,
      releveur: "pdf-text",
      taxCodes: [],
      designation: {
        chaine: async () => chaine,
        appeler: async (m, invite) => {
          assert.ok(
            invite.user.includes("1.3\t"),
            "le désignateur reçoit le plan, jamais la pièce",
          );
          await a.appeler(m);
          return { ...REPONSE, answer: '{"totals":{"ttc":{"page":1,"ordinal":3}}}' };
        },
      },
    }),
  };
}

describe("la chaîne dans la lecture", () => {
  it("Claude tombe : DeepSeek désigne, et la lecture le dit pour le journal", async () => {
    const { lecture, appels } = lire(
      [maillon(1, "anthropic"), maillon(2, "deepseek")],
      new Set(["anthropic"]),
    );
    const lu = await lecture;
    assert.deepEqual(appels, ["anthropic", "deepseek"]);
    assert.equal(lu.selectModel, "deepseek-chat");
    assert.equal(lu.selectRole, "chat");
    assert.equal(lu.bascules?.[0]?.motif, "technique");
    assert.equal(lu.sansModele, undefined);
    assert.deepEqual(lu.selection.totals.ttc, { page: 1, ordinal: 3 });
  });

  it("les deux budgets épuisés : aucune désignation par modèle, sélection vide, motif posé", async () => {
    const { lecture, appels } = lire(
      [maillon(1, "anthropic", true), maillon(2, "deepseek", true)],
      new Set(),
    );
    const lu = await lecture;
    assert.deepEqual(appels, []);
    assert.equal(lu.sansModele, "arret.budgets_epuises");
    assert.equal(lu.selectModel, "arret.budgets_epuises", "la trace de la pièce montre le motif");
    assert.deepEqual(lu.selection.totals, { base_ht: null, vat: null, ttc: null });
    assert.equal(lu.selection.issuer, null, "aucune valeur affirmée sans preuve");
    assert.deepEqual(lu.designation, { latencyMs: 0, tokensIn: null, tokensOut: null });
    assert.equal(lu.tokens.length, PLAN.length, "le plan reste : le Sudoku le lit");
  });

  it("sans chaîne, la lecture refuse de désigner plutôt que de deviner un modèle", async () => {
    await assert.rejects(
      runVisionRead({ dataUrl: "data:,", tokens: PLAN, taxCodes: [] }),
      /designation\.chaine_absente/,
    );
  });
});

/* ------------------------------------------------------------ AU JOURNAL */

describe("la chaîne au journal des exécutions", () => {
  const journal = async (chaine: MaillonDeDesignation[], pannes: ReadonlySet<string>) =>
    entreesDuJournal(await lire(chaine, pannes).lecture).map((e) => [
      e.agent,
      e.model,
      e.role,
      e.status,
      e.erreur?.split(":")[0] ?? null,
    ]);

  it("Claude désigne : une ligne de relevé, une ligne de désignation, rien d'autre", async () => {
    assert.deepEqual(await journal([maillon(1, "anthropic"), maillon(2, "deepseek")], new Set()), [
      ["malica.lecture.releve", "pdf-text", "vision", "ok", null],
      ["malica.lecture.designation", "claude-sonnet-5-5", "chat", "ok", null],
    ]);
  });

  it("repli sur panne : le repli dit « degraded », le maillon tombé a sa ligne à coût nul", async () => {
    const lignes = entreesDuJournal(
      await lire([maillon(1, "anthropic"), maillon(2, "deepseek")], new Set(["anthropic"])).lecture,
    );
    assert.deepEqual(
      lignes.map((e) => [e.model, e.status, e.erreur?.split(":")[0] ?? null]),
      [
        ["pdf-text", "ok", null],
        ["deepseek-chat", "degraded", "repli.technique"],
        ["claude-sonnet-5-5", "error", "bascule.technique"],
      ],
    );
    assert.equal(lignes[2]!.passe.tokensIn, null, "aucun jeton : coût nul au tarif");
  });

  it("arrêt : aucune ligne de désignation, chaque maillon dit l'arrêt", async () => {
    assert.deepEqual(
      await journal([maillon(1, "anthropic", true), maillon(2, "deepseek", true)], new Set()),
      [
        ["malica.lecture.releve", "pdf-text", "vision", "ok", null],
        [
          "malica.lecture.designation",
          "claude-sonnet-5-5",
          "chat",
          "error",
          "arret.budgets_epuises",
        ],
        ["malica.lecture.designation", "deepseek-chat", "chat", "error", "arret.budgets_epuises"],
      ],
    );
  });
});
