/**
 * Le repli DeepSeek, le plafond propre de l'assistant et le fil qui garde ses
 * sources — sans réseau, sans base.
 *
 *   1. quand DeepSeek répond en repli, le FIL range la version contrôlée par la
 *      garde des chiffres, jamais la réponse brute — éprouvé à travers le vrai
 *      `askMalica`, son `fetch` remplacé par un DeepSeek fictif ;
 *   2. au-delà du plafond de l'assistant (150 $ par mois, défaut livré),
 *      Claude n'est pas appelé : DeepSeek répond, puis l'arrêt si DeepSeek est
 *      épuisé ;
 *   3. une réponse de Claude range ses sources et ses propositions avec elle.
 *
 *   node --experimental-strip-types --test src/malica/assistant/repli.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { EvenementDeLAssistant, FinDeLaReponse } from "@malica/socle/ports/assistant";

import type { AppelApi } from "../appel-local.ts";
import {
  converserAvecRepli,
  type DependancesDeLAssistant,
  type DossierVerifie,
  type QuestionPosee,
} from "./agent.ts";
import type { ClientEnFlux, EvenementClaude } from "./claude-flux.ts";
import { lireConfigurationAssistant } from "./configuration.ts";
import { repliParDeepSeek } from "./repli.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PIECE = "a0000000-0000-4000-8000-000000000001";

const DOSSIER: DossierVerifie = {
  organisation: {
    id: TENANT,
    name: "SOTUMAG d'essai",
    kind: "pme",
    jurisdiction: "TN",
    currency: "TND",
    role: "proprietaire",
  },
};

const CONSIGNE = "Tu es Malica. ".repeat(30);

function configuration(plafond: { depense: number; plafond?: number }) {
  return {
    consigne: { id: "consigne-1", texte: CONSIGNE, decide_le: "2026-11-08" },
    reglage: {
      modele_courant: "modele-courant",
      modele_difficile: "modele-difficile",
      longueur_difficile: 400,
      mots_difficiles: [],
      effort_courant: "medium",
      effort_difficile: "medium",
      reflexion_courant: "disabled",
      reflexion_difficile: "between_tools",
      iterations_max: 4,
      sortie_max_jetons: 2048,
      tours_transmis: 8,
    },
    tarifs: [{ model: "modele-courant", role: "chat", in: 0.1, out: 0.5 }],
    plafond: {
      plafond: plafond.plafond ?? 150,
      periode: "mois",
      depense: plafond.depense,
      epuise: plafond.depense >= (plafond.plafond ?? 150),
    },
  };
}

const chaine = (anthropicEpuise: boolean, deepseekEpuise: boolean) => [
  {
    rang: 1,
    fournisseur: "anthropic",
    modele: "claude-haiku-5-5",
    role: "chat",
    periode: "mois",
    plafond: 500,
    depense: 1,
    epuise: anthropicEpuise,
  },
  {
    rang: 2,
    fournisseur: "deepseek",
    modele: "deepseek-chat",
    role: "chat",
    periode: "mois",
    plafond: 20,
    depense: 0,
    epuise: deepseekEpuise,
  },
];

interface MessageRange {
  role: "user" | "assistant";
  contenu: string;
  sources?: unknown[] | null;
  propositions?: unknown[] | null;
}

/**
 * Un dossier fictif : la chaîne, la configuration, le fil (qui range ce qu'on
 * lui donne, sources comprises) et le contexte que lit `askMalica`. Tout autre
 * appel échoue — comme une base qui n'a pas la fonction.
 */
function dossierFictif(options: {
  anthropicEpuise?: boolean;
  deepseekEpuise?: boolean;
  depenseDeLAssistant?: number;
}) {
  const fils = new Map<string, MessageRange[]>();
  const appels: string[] = [];
  let n = 0;
  const api: AppelApi = {
    async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
      const nom = `${depot}.${methode}`;
      appels.push(nom);
      const r = (x: unknown) => x as T;
      switch (nom) {
        case "conseil.exigerBudget":
          return r({ depense: "0", plafond: "10" });
        case "conseil.configurationAssistant":
          return r(configuration({ depense: options.depenseDeLAssistant ?? 0 }));
        case "capture.chaineDeDesignation":
          return r(chaine(options.anthropicEpuise ?? false, options.deepseekEpuise ?? false));
        case "capture.journaliserAgent":
          return r("run");
        case "conversations.ouvrirNouvelle": {
          const id = `c0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
          fils.set(id, []);
          return r({ id });
        }
        case "conversations.ouvrir":
          return r([...(fils.get(args[0] as string) ?? [])]);
        case "conversations.ajouter": {
          const a = args[0] as {
            conversationId: string;
            question: string;
            reponse: string;
            sources?: unknown[] | null;
            propositions?: unknown[] | null;
          };
          fils.get(a.conversationId)?.push(
            { role: "user", contenu: a.question },
            {
              role: "assistant",
              contenu: a.reponse,
              sources: a.sources ?? null,
              propositions: a.propositions ?? null,
            },
          );
          return r(undefined);
        }
        case "conversations.dernierMessage":
          return r({ id: "m1" });
        case "conversations.renommer":
        case "conversations.journaliserControles":
          return r(undefined);
        case "capture.contexteAssistant":
          return r({
            organisation: { id: TENANT, name: "SOTUMAG d'essai", jurisdiction: "TN" },
            pack: null,
            fiche: null,
            pieces: [{ status: "lue" }],
            ecritures: [
              { id: "e1", date: "2026-11-02", journal: "ACH", libelle: "TVA", status: "proposee" },
            ],
            lignes: [
              {
                ecritureId: "e1",
                compte: "4366",
                libelle: "TVA à payer",
                debit: 0,
                credit: 1090.504,
                taxCode: null,
              },
            ],
            echeances: [],
            motifs: [],
            roles: [],
            sousComptes: [],
            tiers: [],
            piece: null,
          });
        default:
          throw new Error(`appel non prévu par l'épreuve : ${nom}`);
      }
    },
    async contenu() {
      throw new Error("le modèle ne lit jamais les octets d'une pièce (R2)");
    },
  };
  return { api, fils, appels };
}

const QUESTION: QuestionPosee = {
  tenantId: TENANT,
  question: "Ma TVA ce mois-ci ?",
  locale: "fr",
  conversationId: null,
  pieceIds: [],
};

async function rejouer(
  api: AppelApi,
  deps: DependancesDeLAssistant,
  question: QuestionPosee = QUESTION,
): Promise<{ fin: FinDeLaReponse; evenements: EvenementDeLAssistant[] }> {
  const evenements: EvenementDeLAssistant[] = [];
  let t = 0;
  const fin = await converserAvecRepli(
    api,
    DOSSIER,
    question,
    {
      ...deps,
      maintenant: () => (t += 50),
      aujourdhui: () => "2026-11-08",
      idProposition: () => "prop-1",
    },
    (e) => evenements.push(e),
  );
  return { fin, evenements };
}

const pasDeClaude: ClientEnFlux = () => {
  throw new Error("Claude ne devait pas être appelé");
};
const pasDeConseil: DependancesDeLAssistant["conseil"] = () => {
  throw new Error("le conseil ne devait pas être appelé");
};

/* --------------------------------------- DeepSeek fictif, derrière `fetch` -- */

const BRUTE =
  "Votre TVA à payer est de 1090.504 TND. Vous économiserez 300 dinars en déclarant tôt.";
const CONTROLEE = "Votre TVA à payer est de 1090.504 TND.";

let fetchOriginal: typeof fetch;
let cleOriginale: string | undefined;
let appelsDeepSeek = 0;

beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  cleOriginale = process.env["DEEPSEEK_API_KEY"];
  process.env["DEEPSEEK_API_KEY"] = "cle-d-essai";
  appelsDeepSeek = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const adresse = String(url instanceof Request ? url.url : url);
    if (!adresse.includes("deepseek")) throw new Error(`réseau interdit : ${adresse}`);
    appelsDeepSeek += 1;
    // Le premier appel répond ; le second nomme le fil.
    const contenu = appelsDeepSeek === 1 ? BRUTE : "TVA du mois";
    return new Response(
      JSON.stringify({
        model: "deepseek-chat",
        choices: [{ message: { content: contenu } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (cleOriginale === undefined) delete process.env["DEEPSEEK_API_KEY"];
  else process.env["DEEPSEEK_API_KEY"] = cleOriginale;
});

describe("le repli DeepSeek range la version contrôlée", () => {
  it("le fil garde la réponse sans la phrase chiffrée sans source — par le vrai askMalica", async () => {
    const { api, fils } = dossierFictif({ anthropicEpuise: true });
    const { fin, evenements } = await rejouer(api, {
      claude: pasDeClaude,
      conseil: pasDeConseil,
      repli: repliParDeepSeek(api, { tenantId: TENANT, locale: "fr" }),
    });
    assert.equal(fin.mesure.repli, "deepseek");
    assert.equal(fin.mesure.motifDuRepli, "budget_claude");
    assert.equal(fin.reponse, CONTROLEE);
    assert.deepEqual(fin.chiffresRetires, ["Vous économiserez 300 dinars en déclarant tôt."]);
    // Ce que le fil a rangé est exactement ce que l'écran a vu.
    const fil = fils.get(fin.conversationId)!;
    assert.equal(fil.at(-1)!.role, "assistant");
    assert.equal(fil.at(-1)!.contenu, CONTROLEE);
    assert.ok(!fil.some((m) => m.contenu.includes("300")), "la phrase retirée n'est pas rangée");
    const montre = evenements.flatMap((e) => (e.type === "texte" ? [e.texte] : [])).join("");
    assert.equal(montre, CONTROLEE);
  });

  it("un repli qui n'appellerait pas `garder` ne montre aucune phrase chiffrée", async () => {
    const { api } = dossierFictif({ anthropicEpuise: true });
    const { fin } = await rejouer(api, {
      claude: pasDeClaude,
      conseil: pasDeConseil,
      repli: async () => ({
        answer: BRUTE,
        model: "deepseek-chat",
        conversationId: "c-x",
        messageId: null,
        titre: null,
      }),
    });
    assert.equal(fin.chiffresRetires.length, 2);
    assert.doesNotMatch(fin.reponse, /\d/);
  });
});

describe("le plafond propre de l'assistant", () => {
  it("se lit en base, et son absence est une panne qui se dit (R4)", () => {
    const c = lireConfigurationAssistant(configuration({ depense: 12.5 }));
    assert.deepEqual(c.plafond, { plafond: 150, periode: "mois", depense: 12.5, epuise: false });
    const { plafond: _sans, ...sansPlafond } = configuration({ depense: 0 });
    assert.throws(() => lireConfigurationAssistant(sansPlafond), /assistant\.plafond_absent/);
  });

  it("atteint : Claude n'est pas appelé, DeepSeek répond — la chaîne commune, elle, n'est pas épuisée", async () => {
    const { api, fils } = dossierFictif({ depenseDeLAssistant: 150 });
    const { fin } = await rejouer(api, {
      claude: pasDeClaude,
      conseil: pasDeConseil,
      repli: repliParDeepSeek(api, { tenantId: TENANT, locale: "fr" }),
    });
    assert.equal(fin.mesure.repli, "deepseek");
    assert.equal(fin.mesure.motifDuRepli, "plafond_assistant");
    assert.equal(appelsDeepSeek >= 1, true);
    assert.equal(fils.get(fin.conversationId)!.at(-1)!.contenu, CONTROLEE);
  });

  it("atteint et DeepSeek épuisé : l'arrêt, sans aucun appel de modèle", async () => {
    const { api, appels } = dossierFictif({ depenseDeLAssistant: 151, deepseekEpuise: true });
    const { fin } = await rejouer(api, {
      claude: pasDeClaude,
      conseil: pasDeConseil,
      repli: () => {
        throw new Error("aucun modèle ne devait être appelé");
      },
    });
    assert.equal(fin.mesure.repli, "arret");
    assert.equal(fin.mesure.motifDuRepli, "plafond_assistant");
    assert.equal(appelsDeepSeek, 0);
    assert.equal(appels.includes("capture.journaliserAgent"), false);
  });

  it("sous le plafond : Claude répond", async () => {
    const { api } = dossierFictif({ depenseDeLAssistant: 149.99 });
    const { fin } = await rejouer(api, {
      claude: claudeQuiDit("Bonjour, que puis-je pour vous ?"),
      conseil: pasDeConseil,
      repli: () => {
        throw new Error("le repli ne devait pas être appelé");
      },
    });
    assert.equal(fin.mesure.repli, null);
    assert.equal(fin.mesure.motifDuRepli, null);
  });

  it("la lecture des pièces n'en dépend pas : l'agent ne touche pas à la chaîne commune", async () => {
    // Le plafond de l'assistant est lu dans SA configuration ; la chaîne de
    // désignation (que lit la lecture des pièces) n'est que consultée.
    const { api, appels } = dossierFictif({ depenseDeLAssistant: 200 });
    await rejouer(api, {
      claude: pasDeClaude,
      conseil: pasDeConseil,
      repli: repliParDeepSeek(api, { tenantId: TENANT, locale: "fr" }),
    });
    assert.equal(
      appels.some((a) => /designation|regler/i.test(a) && a !== "capture.chaineDeDesignation"),
      false,
    );
  });
});

/* ---------------------------------------------- les sources rangées au fil -- */

/** Un Claude qui appelle `pieces_chercher`, puis cite la pièce et propose de l'envoyer. */
function claudeQuiDit(texte: string, outils: Array<{ nom: string; entree: unknown }> = []) {
  let k = 0;
  const client: ClientEnFlux = async function* () {
    const etape = k++;
    const ev: EvenementClaude[] = [
      {
        type: "message_start",
        message: { model: "modele-courant", usage: { input_tokens: 10, output_tokens: 1 } },
      },
    ];
    const appelle = etape < outils.length;
    if (appelle) {
      const o = outils[etape]!;
      ev.push(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: `toolu_${etape}`, name: o.nom, input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(o.entree) },
        },
        { type: "content_block_stop", index: 0 },
      );
    } else {
      ev.push(
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: texte } },
        { type: "content_block_stop", index: 0 },
      );
    }
    ev.push(
      {
        type: "message_delta",
        delta: { stop_reason: appelle ? "tool_use" : "end_turn" },
        usage: { output_tokens: 5 },
      },
      { type: "message_stop" },
    );
    for (const e of ev) yield e;
  };
  return client;
}

describe("le fil garde les sources et les propositions de la réponse", () => {
  it("une proposition faite par Claude est rangée avec la réponse, et revient à la réouverture", async () => {
    const { api, fils } = dossierFictif({});
    const avecPiece: AppelApi = {
      async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
        if (`${depot}.${methode}` === "capture.dossier") {
          return {
            piece: {
              id: PIECE,
              tenantId: TENANT,
              status: "lue",
              documentKind: "facture_achat",
              vis: "entite",
              transmiseLe: null,
            },
            extraction: {
              contract: "extract.v1",
              payload: { issuer: "STEG", document_date: "2026-11-02" },
              flags: [],
            },
          } as T;
        }
        return api.rpc<T>(depot, methode, args);
      },
      contenu: (pieceId) => api.contenu(pieceId),
    };
    const { fin } = await rejouer(avecPiece, {
      claude: claudeQuiDit("Confirmez avec le bouton ci-dessous si vous le souhaitez.", [
        {
          nom: "action_proposer",
          entree: { action: "envoyer_au_cabinet", piece_id: PIECE, raison: "Vous l'avez demandé." },
        },
      ]),
      conseil: pasDeConseil,
      repli: () => {
        throw new Error("le repli ne devait pas être appelé");
      },
    });
    assert.equal(fin.propositions.length, 1);
    const range = fils.get(fin.conversationId)!.at(-1)!;
    assert.deepEqual(range.propositions, fin.propositions);
    assert.deepEqual(range.sources, fin.sources);
    // À la réouverture, le fil les rend tels quels.
    const relu = await api.rpc<MessageRange[]>("conversations", "ouvrir", [fin.conversationId]);
    assert.deepEqual(relu.at(-1)!.propositions, fin.propositions);
  });
});
