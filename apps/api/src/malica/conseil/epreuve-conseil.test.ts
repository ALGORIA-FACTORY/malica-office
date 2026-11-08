/**
 * L'épreuve du conseil cité, rejouée SANS RÉSEAU.
 *
 * Le jeu est le vrai (`epreuve-conseil.json`). La base est simulée : la
 * recherche rend, pour chaque question couverte, l'extrait du corpus que le
 * jeu porte, et rien pour un piège. Claude est simulé : un lecteur fidèle qui
 * cite ce qu'on lui montre, puis un bavard qui répond de mémoire. La note
 * doit séparer les deux.
 *
 * Et le geste lui-même : le plafond avant l'encodeur, aucun appel quand rien
 * ne répond, le journal par rôle tarifé, l'échec qui se journalise.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { PassageTrouve } from "../../depots/corpus.ts";
import type { AppelApi } from "../appel-local.ts";
import type { ReponseClaudeBrute, RequeteClaude } from "./cite.ts";
import type { ClientClaude } from "./client-claude.ts";
import { AGENT_CONSEIL_CITE, conseilCite, mentionDeVigueur } from "./conseil-cite.ts";
import {
  bilanDeLEpreuve,
  bilanEnTexte,
  lireLeJeu,
  normaliser,
  noterLeCas,
  type CasDEpreuve,
} from "./epreuve-conseil.ts";

const JEU = lireLeJeu(
  JSON.parse(readFileSync(new URL("./epreuve-conseil.json", import.meta.url), "utf8")),
);
const TENANT = "00000000-0000-4000-8000-000000000001";

const CONFIGURATION = {
  consigne: { id: "consigne-1", texte: "Consigne d'essai, lue en base.", decide_le: "2026-11-08" },
  reglage: {
    modele_courant: "claude-haiku-5-5",
    modele_difficile: "claude-sonnet-5-5",
    longueur_difficile: 320,
    mots_difficiles: ["non-résident", "plus-value"],
    corpus_distincts_difficile: 3,
    passages_max: 8,
    distance_max: 0.37,
    distance_max_mots: 0.45,
    sortie_max_jetons: 1500,
  },
  tarifs: [
    { model: "claude-haiku-5-5", role: "chat", in: 0.1, out: 0.5 },
    { model: "claude-haiku-5-5", role: "cache", in: 0.01, out: 0 },
    { model: "claude-haiku-5-5", role: "cache_ecriture", in: 0.125, out: 0 },
    { model: "claude-sonnet-5-5", role: "chat", in: 2, out: 10 },
    { model: "claude-sonnet-5-5", role: "cache", in: 0.1, out: 0 },
    { model: "claude-sonnet-5-5", role: "cache_ecriture", in: 2.5, out: 0 },
  ],
  sources: [],
};

function passageDuCas(cas: CasDEpreuve): PassageTrouve[] {
  if (cas.attendu.type !== "reponse") return [];
  const a = cas.attendu.articles[0]!;
  return [
    {
      corpus: a.corpus,
      numero: a.numero,
      validFrom: a.validFrom ?? null,
      validTo: null,
      ordinal: 1,
      langue: "fr",
      texte: cas.attendu.extrait,
      entete: null,
      statut: "en_vigueur",
      abrogePar: null,
      nature: "Loi",
      autorite: "normative",
      opposableA: "administration, contribuable, juge",
      jortReference: null,
      provenance: "verbatim",
      distance: 0.2,
      parLesMots: true,
      score: 0.03,
      lacune: false,
      reprise: null,
    },
  ];
}

interface Trace {
  appels: string[];
  journal: Array<Record<string, unknown>>;
  recherches: Array<Record<string, unknown>>;
}

function baseSimulee(
  passages: PassageTrouve[],
  options: { juridiction?: string | null } = {},
): { api: AppelApi; trace: Trace } {
  const trace: Trace = { appels: [], journal: [], recherches: [] };
  const api: AppelApi = {
    async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
      const nom = `${depot}.${methode}`;
      trace.appels.push(nom);
      switch (nom) {
        case "identite.listMyOrganizations":
          return [
            {
              id: TENANT,
              jurisdiction: options.juridiction === undefined ? "TN" : options.juridiction,
            },
          ] as T;
        case "conseil.exigerBudget":
          return { depense: "0", plafond: "10" } as T;
        case "conseil.configurationCitee":
          return CONFIGURATION as T;
        case "corpus.rechercherHybride":
          trace.recherches.push(args[0] as Record<string, unknown>);
          return passages as T;
        case "corpus.parametresPour":
          return [] as T;
        case "conseil.nomsDesCorpus":
          return {} as T;
        case "capture.journaliserAgent":
          trace.journal.push(args[0] as Record<string, unknown>);
          return "run-1" as T;
        default:
          throw new Error(`appel inattendu : ${nom}`);
      }
    },
    async contenu() {
      throw new Error("aucune pièce dans le conseil cité");
    },
  };
  return { api, trace };
}

/** Un Claude qui cite ce qu'on lui montre : le premier bloc du premier résultat. */
function lecteurFidele(): ClientClaude & { requetes: RequeteClaude[] } {
  const requetes: RequeteClaude[] = [];
  return {
    requetes,
    async envoyer(requete) {
      requetes.push(requete);
      const premier = requete.messages[0]!.content.find((b) => b.type === "search_result");
      assert.ok(
        premier && premier.type === "search_result",
        "un résultat de recherche était attendu",
      );
      const reponse: ReponseClaudeBrute = {
        model: requete.model,
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Selon le texte : " },
          {
            type: "text",
            text: premier.content[0]!.text,
            citations: [
              {
                type: "search_result_location",
                source: premier.source,
                title: premier.title,
                cited_text: premier.content[0]!.text,
                search_result_index: 0,
                start_block_index: 0,
                end_block_index: 1,
              },
            ],
          },
        ],
        usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 800 },
      };
      return { reponse, latencyMs: 900 };
    },
  };
}

/** Un Claude qui répond de mémoire : fluide, chiffré, sans une citation. */
const bavard: ClientClaude = {
  async envoyer(requete) {
    return {
      reponse: {
        model: requete.model,
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Le taux est de 20 %, comme chacun le sait depuis 2014." }],
        usage: { input_tokens: 1000, output_tokens: 40 },
      },
      latencyMs: 700,
    };
  },
};

async function rejouer(client: ClientClaude) {
  const notes = [];
  for (const cas of JEU) {
    const { api } = baseSimulee(passageDuCas(cas));
    const r = await conseilCite(
      api,
      { tenantId: TENANT, question: cas.question, locale: cas.locale, jour: cas.jour },
      { client, empreinte: async () => [0.1, 0.2] },
    );
    notes.push(noterLeCas(cas, r));
  }
  return bilanDeLEpreuve(notes);
}

describe("le jeu de l'épreuve", () => {
  it("porte entre 15 et 25 questions couvertes, et au moins trois pièges", () => {
    const couvertes = JEU.filter((c) => c.attendu.type === "reponse").length;
    const pieges = JEU.filter((c) => c.attendu.type === "refus").length;
    assert.ok(couvertes >= 15 && couvertes <= 25, `${couvertes} questions couvertes`);
    assert.ok(pieges >= 3, `${pieges} pièges`);
  });

  it("chaque marqueur attendu se lit dans l'extrait du corpus que le cas recopie", () => {
    for (const cas of JEU) {
      if (cas.attendu.type !== "reponse") continue;
      const extrait = normaliser(cas.attendu.extrait);
      for (const m of cas.attendu.marqueurs) {
        assert.match(extrait, new RegExp(m, "iu"), `${cas.id} : « ${m} » absent de l'extrait`);
      }
    }
  });

  it("la règle du temps est éprouvée : le même article à trois dates, et une date sans édition", () => {
    const is = JEU.filter(
      (c) => c.attendu.type === "reponse" && c.attendu.articles.some((a) => a.numero === "49"),
    );
    const versions = new Set(
      is.flatMap((c) =>
        c.attendu.type === "reponse" ? c.attendu.articles.map((a) => a.validFrom) : [],
      ),
    );
    assert.ok(versions.size >= 3, "trois versions de l'article 49");
    assert.ok(JEU.some((c) => c.id === "piege-trou-d-edition" && c.attendu.type === "refus"));
  });

  it("refuse un jeu mal formé", () => {
    assert.throws(
      () => lireLeJeu({ cas: [{ id: "a", question: "q", jour: "2026-01-01" }] }),
      /attendu/,
    );
    assert.throws(() => lireLeJeu({}), /pas de cas/);
  });
});

describe("l'épreuve rejouée, sans réseau", () => {
  it("un lecteur fidèle obtient tout : réponses, citations, refus, et un coût", async () => {
    const client = lecteurFidele();
    const b = await rejouer(client);
    assert.equal(b.reponses.justes, b.reponses.total, bilanEnTexte(b));
    assert.equal(b.reponses.citationsJustes, b.reponses.total);
    assert.equal(b.pieges.refusCorrects, b.pieges.total);
    assert.equal(b.reponses.fauxRefus, 0);
    assert.equal(b.versionsMelangees, 0);
    // Les pièges n'ont rien trouvé : Claude n'a pas été appelé pour eux.
    assert.equal(client.requetes.length, b.reponses.total);
    assert.ok(b.cout.totalUsd > 0);
    assert.equal(b.cout.inconnus, 0);
    // La règle simple a envoyé les questions « non-résident » et « plus-value » au modèle difficile.
    assert.ok((b.modeles["claude-sonnet-5-5"] ?? 0) >= 2, JSON.stringify(b.modeles));
    assert.ok((b.modeles["claude-haiku-5-5"] ?? 0) > (b.modeles["claude-sonnet-5-5"] ?? 0));
  });

  it("un bavard qui répond de mémoire n'obtient rien : sans citation, c'est un refus", async () => {
    const b = await rejouer(bavard);
    assert.equal(b.reponses.justes, 0);
    assert.equal(b.reponses.citationsJustes, 0);
    assert.equal(b.reponses.fauxRefus, b.reponses.total);
    // Ses chiffres ne sortent pas : ils sont retirés, jamais rendus sans citation.
    assert.equal(b.chiffresNonCites, 0);
    assert.ok(b.chiffresRetires >= b.reponses.total);
  });
});

describe("le geste du conseil cité", () => {
  const cas = JEU.find((c) => c.id === "ras-honoraires")!;

  it("le plafond passe avant l'encodeur, et la date d'effet descend jusqu'à la recherche", async () => {
    const { api, trace } = baseSimulee(passageDuCas(cas));
    const ordre: string[] = [];
    const r = await conseilCite(
      api,
      { tenantId: TENANT, question: cas.question, locale: "fr" },
      {
        client: lecteurFidele(),
        empreinte: async () => {
          ordre.push(...trace.appels);
          return [0.1];
        },
        aujourdhui: () => "2026-11-08",
      },
    );
    assert.ok(ordre.includes("conseil.exigerBudget"));
    assert.equal(trace.recherches[0]!["jour"], "2026-11-08");
    assert.equal(r.enVigueurAu, "2026-11-08");
    assert.match(
      r.mention ?? "",
      /^En vigueur au 8 novembre 2026 : CIRPPIS, art\. 52 \(version du 1 janvier 2026\)\.$/,
    );
  });

  it("le journal porte une ligne par rôle tarifé, au nom de l'organe", async () => {
    const { api, trace } = baseSimulee(passageDuCas(cas));
    await conseilCite(
      api,
      { tenantId: TENANT, question: cas.question, locale: "fr", jour: cas.jour },
      { client: lecteurFidele(), empreinte: async () => [0.1] },
    );
    assert.deepEqual(
      trace.journal.map((l) => [l["agent"], l["role"], l["tokensIn"], l["tokensOut"]]),
      [
        [AGENT_CONSEIL_CITE, "chat", 1200, 150],
        [AGENT_CONSEIL_CITE, "cache", 800, 0],
      ],
    );
  });

  it("un échec de Claude se journalise, puis remonte", async () => {
    const { api, trace } = baseSimulee(passageDuCas(cas));
    await assert.rejects(
      conseilCite(
        api,
        { tenantId: TENANT, question: cas.question, locale: "fr", jour: cas.jour },
        {
          client: {
            envoyer: async () => {
              throw new Error("Claude 529 : surcharge");
            },
          },
          empreinte: async () => [0.1],
        },
      ),
      /surcharge/,
    );
    assert.equal(trace.journal.length, 1);
    assert.equal(trace.journal[0]!["status"], "error");
  });

  it("rien ne répond : refus dans la langue, sans appel à Claude", async () => {
    const { api, trace } = baseSimulee([]);
    let appele = false;
    const r = await conseilCite(
      api,
      {
        tenantId: TENANT,
        question: "ما هو نظام الضمان الاجتماعي في بلجيكا؟",
        locale: "ar",
        jour: "2026-06-30",
      },
      {
        client: {
          envoyer: async () => {
            appele = true;
            throw new Error("ne doit pas être appelé");
          },
        },
        empreinte: async () => [0.1],
      },
    );
    assert.equal(appele, false);
    assert.equal(r.refus, true);
    assert.equal(r.horsCorpus, true);
    assert.equal(r.reponse, "لا أجد هذا في النصوص التي بين يديّ.");
    assert.equal(r.coutUsd, 0);
    assert.equal(trace.journal.length, 0);
  });

  it("une organisation sans juridiction ne lit pas « tunisien » par défaut (R4)", async () => {
    const { api } = baseSimulee(passageDuCas(cas), { juridiction: null });
    await assert.rejects(
      conseilCite(
        api,
        { tenantId: TENANT, question: cas.question, locale: "fr", jour: cas.jour },
        { client: lecteurFidele(), empreinte: async () => [0.1] },
      ),
      /juridiction_absente/,
    );
  });

  it("l'article qui répond n'a pas de version au jour dit : refus de la règle du temps, sans appel", async () => {
    const [p] = passageDuCas(cas);
    const lacune = {
      ...p!,
      validFrom: "2023-01-01",
      validTo: "2024-01-01",
      lacune: true,
      reprise: "2025-01-01",
    };
    const autre = { ...p!, corpus: "LF-2021", numero: "14", validFrom: "2021-01-01" };
    const { api, trace } = baseSimulee([lacune, autre]);
    let appele = false;
    const r = await conseilCite(
      api,
      { tenantId: TENANT, question: "Taux de l'IS ?", locale: "fr", jour: "2024-06-30" },
      {
        client: {
          envoyer: async () => {
            appele = true;
            throw new Error("ne doit pas être appelé");
          },
        },
        empreinte: async () => [0.1],
      },
    );
    assert.equal(appele, false);
    assert.equal(r.refus, true);
    assert.match(
      r.reponse,
      /Je ne trouve pas le texte en vigueur au 30 juin 2024 : le corpus connaît CIRPPIS, art\. 52, jusqu’au 1 janvier 2024, puis de nouveau à partir du 1 janvier 2025/,
    );
    assert.deepEqual(r.lacunes, [
      { corpus: "CIRPPIS", numero: "52", jusquAu: "2024-01-01", reprise: "2025-01-01" },
    ]);
    assert.equal(trace.journal.length, 0);
  });

  it("une lacune qui n'est pas en tête n'est jamais remise au modèle", async () => {
    const [p] = passageDuCas(cas);
    const lacune = { ...p!, numero: "99", lacune: true, reprise: "2027-01-01" };
    const { api } = baseSimulee([p!, lacune]);
    const client = lecteurFidele();
    const r = await conseilCite(
      api,
      { tenantId: TENANT, question: cas.question, locale: "fr", jour: cas.jour },
      { client, empreinte: async () => [0.1] },
    );
    const blocs = client.requetes[0]!.messages[0]!.content.filter(
      (b) => b.type === "search_result",
    );
    assert.equal(blocs.length, 1);
    assert.equal(r.lacunes.length, 1);
    assert.equal(r.refus, false);
  });

  it("une réponse vide du modèle courant repasse une fois au modèle difficile", async () => {
    const { api, trace } = baseSimulee(passageDuCas(cas));
    const fidele = lecteurFidele();
    const modeles: string[] = [];
    const r = await conseilCite(
      api,
      { tenantId: TENANT, question: cas.question, locale: "fr", jour: cas.jour },
      {
        client: {
          async envoyer(requete) {
            modeles.push(requete.model);
            if (modeles.length === 1) {
              return {
                reponse: {
                  model: requete.model,
                  stop_reason: "max_tokens",
                  content: [],
                  usage: { input_tokens: 1000, output_tokens: 4096 },
                },
                latencyMs: 500,
              };
            }
            return fidele.envoyer(requete);
          },
        },
        empreinte: async () => [0.1],
      },
    );
    assert.deepEqual(modeles, ["claude-haiku-5-5", "claude-sonnet-5-5"]);
    assert.equal(r.escalade, true);
    assert.equal(r.refus, false);
    assert.equal(r.modele, "claude-sonnet-5-5");
    // Les deux appels sont journalisés, et le coût les additionne.
    assert.equal(trace.journal.filter((l) => l["role"] === "chat").length, 2);
    const haiku = (1000 * 0.1 + 4096 * 0.5) / 1e6;
    const sonnet = (1200 * 2 + 150 * 10 + 800 * 0.1) / 1e6;
    assert.ok(Math.abs((r.coutUsd ?? 0) - (haiku + sonnet)) < 1e-6);
  });

  it("aucune mention de vigueur sans article cité", () => {
    assert.equal(mentionDeVigueur("2026-06-30", [], "fr"), null);
  });
});
