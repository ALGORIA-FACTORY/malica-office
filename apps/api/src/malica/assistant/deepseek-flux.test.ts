/**
 * DeepSeek dans la boucle d'outils de Claude, en pur : aucun réseau.
 *
 * Ce que l'épreuve fige : la requête qui part chez DeepSeek (sans cache ni
 * réflexion Claude, passages numérotés dans l'ordre de la garde), et le flux
 * qui revient (marqueurs retirés du texte, citations que la garde relit,
 * aucune réflexion relayée, un marqueur coupé en deux morceaux).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvenementClaude } from "./claude-flux.ts";
import { adapterLaRequete, clientDeepSeekEnFlux, TraducteurDeFlux } from "./deepseek-flux.ts";
import { GardeDesChiffres, type SourceConnue } from "./garde.ts";

const recherche = (cle: string, titre: string, ...paragraphes: string[]) => ({
  type: "search_result",
  source: cle,
  title: titre,
  content: paragraphes.map((text) => ({ type: "text", text })),
  citations: { enabled: true },
});

describe("la requête de Claude, au format DeepSeek", () => {
  const requete = {
    model: "deepseek-chat",
    max_tokens: 2000,
    output_config: { effort: "medium" },
    thinking: { type: "adaptive" },
    cache_control: { type: "ephemeral" },
    tools: [
      { name: "a", input_schema: { type: "object" } },
      { name: "b", input_schema: { type: "object" }, cache_control: { type: "ephemeral" } },
    ],
    system: [
      { type: "text", text: "Consigne", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Contexte du jour" },
    ],
    messages: [
      { role: "user", content: "Où en est ma TVA ?" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "tva_du_mois", input: {} }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              recherche(
                "malica:tva:2026-11",
                "TVA de novembre",
                "Collectée : 0.000 TND",
                "Déductible : 342.000 TND",
              ),
              recherche("malica:echeance:1", "Échéance", "Le 28 du mois suivant"),
            ],
          },
        ],
      },
    ],
  };

  it("retire le cache et la réflexion réglée pour Claude, et joint la consigne en un texte", () => {
    const { corps } = adapterLaRequete(requete);
    assert.equal(corps["output_config"], undefined);
    // La réflexion est coupée : DeepSeek exigerait de la recevoir en retour.
    assert.deepEqual(corps["thinking"], { type: "disabled" });
    assert.equal(corps["cache_control"], undefined);
    assert.equal(corps["system"], "Consigne\n\nContexte du jour");
    assert.equal(JSON.stringify(corps).includes("cache_control"), false);
    assert.equal(corps["model"], "deepseek-chat");
    assert.equal((corps["tools"] as unknown[]).length, 2);
  });

  it("numérote les passages dans l'ordre où la garde les a reçus", () => {
    const { corps, passages } = adapterLaRequete(requete);
    assert.deepEqual(
      passages.map((p) => p.cle),
      ["malica:tva:2026-11", "malica:echeance:1"],
    );
    const resultat = (corps["messages"] as Array<{ content: unknown }>)[2]!.content as Array<{
      content: string;
    }>;
    assert.match(
      resultat[0]!.content,
      /^\[S1\] TVA de novembre\nCollectée : 0\.000 TND\nDéductible : 342\.000 TND/,
    );
    assert.match(resultat[0]!.content, /\[S2\] Échéance\nLe 28 du mois suivant$/);
  });

  it("ne modifie pas la requête reçue", () => {
    const avant = JSON.stringify(requete);
    adapterLaRequete(requete);
    assert.equal(JSON.stringify(requete), avant);
  });
});

/** Un flux de texte en morceaux, comme DeepSeek les envoie. */
const fluxDeTexte = (...morceaux: string[]): EvenementClaude[] => [
  { type: "message_start", message: { model: "deepseek-chat" } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ...morceaux.map((text): EvenementClaude => ({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  })),
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
];

const passages = [
  {
    cle: "malica:tva:2026-11",
    titre: "TVA de novembre",
    paragraphes: ["Collectée : 0.000 TND", "Déductible : 342.000 TND"],
  },
  { cle: "malica:echeance:1", titre: "Échéance", paragraphes: ["Le 28 du mois suivant"] },
];

const traduire = (evenements: EvenementClaude[]) => {
  const t = new TraducteurDeFlux(passages);
  return evenements.flatMap((e) => t.recevoir(e));
};
const texteDe = (evs: EvenementClaude[]) =>
  evs
    .filter((e) => e.delta?.type === "text_delta")
    .map((e) => e.delta!.text)
    .join("");
const citationsDe = (evs: EvenementClaude[]) =>
  evs.filter((e) => e.delta?.type === "citations_delta").map((e) => e.delta!.citation!);

describe("le flux de DeepSeek, rendu comme celui de Claude", () => {
  it("retire le marqueur du texte et le rend en citation", () => {
    const sortie = traduire(fluxDeTexte("Votre TVA est un crédit de 342.000 TND [S1]."));
    assert.equal(texteDe(sortie), "Votre TVA est un crédit de 342.000 TND.");
    const [c] = citationsDe(sortie);
    assert.equal(c!["type"], "search_result_location");
    assert.equal(c!["source"], "malica:tva:2026-11");
    assert.equal(c!["search_result_index"], 0);
    assert.equal(c!["cited_text"], "Déductible : 342.000 TND");
  });

  it("recolle un marqueur coupé entre deux morceaux", () => {
    const sortie = traduire(fluxDeTexte("Un crédit de 342.000 TND [S", "1]. Bonne journée."));
    assert.equal(texteDe(sortie).includes("[S"), false);
    assert.equal(citationsDe(sortie).length, 1);
    assert.equal(texteDe(sortie), "Un crédit de 342.000 TND. Bonne journée.");
  });

  it("rend un texte sans marqueur tel quel, sans citation", () => {
    const sortie = traduire(fluxDeTexte("L'inflation, c'est la hausse des prix."));
    assert.equal(texteDe(sortie), "L'inflation, c'est la hausse des prix.");
    assert.equal(citationsDe(sortie).length, 0);
  });

  it("un marqueur posé après le point désigne la phrase d'avant", () => {
    const sortie = traduire(fluxDeTexte("Le crédit est de 342.000 TND. [S1] Autre chose."));
    const [c] = citationsDe(sortie);
    assert.equal(c!["cited_text"], "Déductible : 342.000 TND");
  });

  it("ne cite pas un passage qui n'existe pas", () => {
    const sortie = traduire(fluxDeTexte("Un fait [S9]."));
    assert.equal(citationsDe(sortie).length, 0);
    assert.equal(texteDe(sortie).includes("[S9]"), false);
  });

  it("n'écrit pas en citation un chiffre que la source ne porte pas", () => {
    const sortie = traduire(fluxDeTexte("Le crédit est de 999.000 TND [S1]."));
    const [c] = citationsDe(sortie);
    assert.equal(c!["cited_text"], "");
  });

  it("écarte la réflexion : ni début, ni delta, ni fin de ce bloc", () => {
    const sortie = traduire([
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "secret" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Bonjour." } },
      { type: "content_block_stop", index: 1 },
    ]);
    assert.equal(JSON.stringify(sortie).includes("secret"), false);
    assert.equal(
      sortie.some((e) => e.content_block?.type === "thinking"),
      false,
    );
    assert.equal(texteDe(sortie), "Bonjour.");
  });

  it("coupe un appel d'outil que DeepSeek écrit en clair, et tout ce qui le suit (mesuré sur deepseek-flash)", () => {
    const sortie = traduire(
      fluxDeTexte(
        "Un crédit de 342.000 TND [S1].\n\n",
        '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="conclure_reponse">',
        "\nsuite",
      ),
    );
    assert.equal(texteDe(sortie).trim(), "Un crédit de 342.000 TND.");
    assert.doesNotMatch(JSON.stringify(sortie), /DSML|conclure_reponse/);
  });

  it("coupe l'appel écrit en clair même quand sa balise arrive en morceaux", () => {
    const sortie = traduire(
      fluxDeTexte("Bonjour.\n\n<｜", "｜DSM", "L｜｜ calls> conclure_reponse"),
    );
    assert.equal(texteDe(sortie).trim(), "Bonjour.");
    assert.doesNotMatch(JSON.stringify(sortie), /DSML|conclure_reponse|<｜/);
  });

  it("ne retient pas un « < » ordinaire : il est rendu à la fin du bloc", () => {
    const sortie = traduire(fluxDeTexte("Si x <", " 5 alors oui. Et 3 <"));
    assert.equal(texteDe(sortie), "Si x < 5 alors oui. Et 3 <");
  });

  it("laisse passer un appel d'outil inchangé", () => {
    const evs: EvenementClaude[] = [
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "t1", name: "tva_du_mois", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"mois":"2026-11"}' },
      },
      { type: "content_block_stop", index: 0 },
    ];
    assert.deepEqual(traduire(evs), evs);
  });
});

describe("la garde des chiffres relit les citations de DeepSeek comme celles de Claude", () => {
  const sources: SourceConnue[] = [
    {
      cle: "malica:tva:2026-11",
      genre: "tva",
      titre: "TVA de novembre",
      objetId: null,
      texte: "Collectée : 0.000 TND\n\nDéductible : 342.000 TND",
    },
  ];

  const passerParLaGarde = (flux: EvenementClaude[]) => {
    const garde = new GardeDesChiffres("Où en est ma TVA ?");
    for (const s of sources) garde.ajouterSource(s);
    garde.nouveauTour();
    let montre = "";
    let retirees = 0;
    for (const ev of traduire(flux)) {
      if (ev.type === "content_block_start" && ev.content_block?.type === "text")
        garde.ouvrirBloc();
      else if (ev.delta?.type === "text_delta") montre += garde.recevoirTexte(ev.delta.text ?? "");
      else if (ev.delta?.type === "citations_delta") garde.recevoirCitation(ev.delta.citation!);
      else if (ev.type === "content_block_stop") {
        const j = garde.fermerBloc();
        montre += j.aEmettre;
        retirees += j.retirees.length;
      }
    }
    return { montre, retirees };
  };

  it("garde la phrase chiffrée dont la source porte le chiffre", () => {
    const { montre, retirees } = passerParLaGarde(
      fluxDeTexte("Votre TVA est un crédit de 342.000 TND [S1]."),
    );
    assert.equal(retirees, 0);
    assert.match(montre, /342\.000 TND/);
  });

  it("tient la règle de la garde, la même que pour Claude : un chiffre qu'une source remise porte reste, cité ou non", () => {
    const { montre, retirees } = passerParLaGarde(
      fluxDeTexte("Votre TVA est un crédit de 342.000 TND."),
    );
    assert.equal(retirees, 0);
    assert.match(montre, /342\.000 TND/);
  });

  it("retire la phrase dont le chiffre n'est pas dans la source citée", () => {
    const { montre, retirees } = passerParLaGarde(
      fluxDeTexte("Votre TVA est un crédit de 999.000 TND [S1]."),
    );
    assert.equal(retirees, 1);
    assert.equal(montre.includes("999"), false);
  });
});

describe("le client DeepSeek", () => {
  it("refuse sans clé, sans appeler le réseau", async () => {
    let appels = 0;
    const client = clientDeepSeekEnFlux({
      apiKey: undefined,
      fetch: (async () => {
        appels += 1;
        return new Response("");
      }) as typeof fetch,
    });
    await assert.rejects(async () => {
      for await (const _ of client({ model: "m", messages: [] })) void _;
    }, /DEEPSEEK_API_KEY absente/);
    assert.equal(appels, 0);
  });

  it("envoie la clé en en-tête, jamais dans le corps, et lit le flux traduit", async () => {
    let corpsEnvoye = "";
    let enTetes: Record<string, string> = {};
    const sse = fluxDeTexte("Bonjour [S1].")
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    const client = clientDeepSeekEnFlux({
      apiKey: "cle-d-essai",
      fetch: (async (_url: unknown, init?: RequestInit) => {
        corpsEnvoye = String(init?.body);
        enTetes = init?.headers as Record<string, string>;
        return new Response(sse, { status: 200 });
      }) as typeof fetch,
    });
    const evs: EvenementClaude[] = [];
    for await (const ev of client({
      model: "deepseek-chat",
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t", content: [recherche("c1", "T", "Bonjour")] },
          ],
        },
      ],
    }))
      evs.push(ev);
    assert.equal(enTetes["x-api-key"], "cle-d-essai");
    assert.equal(corpsEnvoye.includes("cle-d-essai"), false);
    assert.equal(JSON.parse(corpsEnvoye).stream, true);
    assert.equal(citationsDe(evs).length, 1);
  });

  it("une panne HTTP est dite sans corps de réponse brut au-delà de 300 caractères", async () => {
    const client = clientDeepSeekEnFlux({
      apiKey: "k",
      fetch: (async () => new Response("x".repeat(1000), { status: 500 })) as typeof fetch,
    });
    await assert.rejects(
      async () => {
        for await (const _ of client({ model: "m", messages: [] })) void _;
      },
      (e: Error) => e.message.length < 330 && /DeepSeek 500/.test(e.message),
    );
  });
});
