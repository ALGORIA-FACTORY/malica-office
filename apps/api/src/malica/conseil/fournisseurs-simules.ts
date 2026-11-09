/**
 * Les fournisseurs de Malica, simulés — pour les épreuves de la section 11.
 *
 * Le chat n'a pas de client injectable : `callDeepSeek` et l'encodeur du
 * corpus appellent `fetch` directement. On remplace donc `fetch` le temps
 * d'une épreuve, comme le faisait `docs/validation-chat-malica/preuves/
 * constats/scripts/intercepter.mjs` : DeepSeek et l'encodeur répondent une
 * réponse fabriquée, tout le reste (l'API locale) passe tel quel. Aucun appel
 * payant ne part.
 *
 * Chaque appel sortant est gardé (URL et corps), pour que l'épreuve dise ce qui
 * a été ENVOYÉ — la consigne, le dossier, le fil, le ton.
 */

import type { AppelApi } from "../appel-local.ts";
import type { FragmentDeDroit, ParametreFiscal } from "./corpus.ts";

interface AppelSortant {
  url: string;
  corps: Record<string, unknown>;
}

export interface MessageEnvoye {
  role: string;
  content: string;
}

export interface Simulation {
  /** Tous les appels sortants simulés, dans l'ordre. */
  sortants: AppelSortant[];
  /** Les appels au modèle (DeepSeek), dans l'ordre. */
  auModele(): AppelSortant[];
  /** Les messages du premier appel au modèle en sortie structurée (la réponse). */
  messagesDeLaReponse(): MessageEnvoye[];
  restaurer(): void;
}

export interface OptionsDeSimulation {
  /**
   * Ce que le modèle rend quand on lui demande un objet JSON (la réponse du
   * chat) : un objet, sérialisé tel quel.
   */
  reponse?: Record<string, unknown>;
  /** Le texte rendu à un appel sans sortie structurée (titre du fil, briefing). */
  texte?: string;
  /** Le raisonnement que le modèle rend à côté de sa réponse. */
  raisonnement?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** L'encodeur tombe : la recherche dans le droit échoue. */
  encodeurEnPanne?: boolean;
}

const VARIABLES = ["DEEPSEEK_API_KEY", "QWEN_BASE_URL", "QWEN_API_KEY"] as const;

export function simulerLesFournisseurs(options: OptionsDeSimulation = {}): Simulation {
  const original = globalThis.fetch;
  const avant = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  process.env["DEEPSEEK_API_KEY"] = "cle-simulee";
  process.env["QWEN_BASE_URL"] = "https://encodeur.simule.invalid";
  process.env["QWEN_API_KEY"] = "cle-simulee";

  const sortants: AppelSortant[] = [];

  globalThis.fetch = async (entree: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    const hote = new URL(url).hostname;
    const estDeepSeek = hote === "api.deepseek.com";
    const estEncodeur = url.endsWith("/embeddings");
    if (!estDeepSeek && !estEncodeur) return original(entree, init);

    const corps = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    sortants.push({ url, corps });

    if (estEncodeur) {
      if (options.encodeurEnPanne) return new Response("encodeur indisponible", { status: 503 });
      const dimensions = Number(corps["dimensions"] ?? 1024);
      const vecteur = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
      return new Response(JSON.stringify({ data: [{ embedding: vecteur }] }), { status: 200 });
    }

    const structure = Boolean(corps["response_format"]);
    const contenu = structure
      ? JSON.stringify(options.reponse ?? { reponse: "Réponse simulée.", conseil: false })
      : (options.texte ?? "Titre simulé");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: contenu,
              reasoning_content: structure ? (options.raisonnement ?? null) : null,
            },
          },
        ],
        usage: options.usage ?? { prompt_tokens: 1000, completion_tokens: 200 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const auModele = () => sortants.filter((s) => new URL(s.url).hostname === "api.deepseek.com");

  return {
    sortants,
    auModele,
    messagesDeLaReponse() {
      const appel = auModele().find((s) => s.corps["response_format"]);
      if (!appel) throw new Error("aucun appel structuré au modèle");
      return appel.corps["messages"] as MessageEnvoye[];
    },
    restaurer() {
      globalThis.fetch = original;
      for (const v of VARIABLES) {
        if (avant[v] === undefined) delete process.env[v];
        else process.env[v] = avant[v];
      }
    },
  };
}

/** Un fragment du corpus, tel que `corpus.rechercher` le rend. */
export function unFragment(p: Partial<FragmentDeDroit> = {}): FragmentDeDroit {
  return {
    corpus: "CTVA",
    numero: "7",
    validFrom: "2026-01-01",
    validTo: null,
    ordinal: 1,
    langue: "fr",
    extrait: "ARTICLE 7.- Sont soumises à la taxe sur la valeur ajoutée les opérations…",
    statut: "en_vigueur",
    abrogePar: null,
    nature: "Loi ordinaire",
    autorite: "normative",
    opposableA: "administration, contribuable, juge",
    jortReference: "JORT 2025/104",
    provenance: "verbatim",
    distance: 0.2,
    ...p,
  };
}

/** Un paramètre du référentiel, tel que `corpus.parametresPour` le rend. */
export function unParametre(p: Partial<ParametreFiscal> = {}): ParametreFiscal {
  return {
    code: "tva_taux_normal",
    libelle: "Taux normal de TVA",
    forme: "taux",
    echelle: "fraction",
    valeur: "0.19",
    corpus: "CTVA",
    article: "art. 7",
    citation: null,
    autorite: "loi",
    confiance: "confirme",
    validFrom: "2018-01-01",
    validTo: null,
    note: null,
    ...p,
  };
}

/** Le contexte brut que `capture.contexteAssistant` rend. */
interface ContexteBrutSimule {
  fiche?: Record<string, unknown> | null;
  pieces?: Array<{ status: string }>;
  ecritures?: Array<Record<string, unknown>>;
  lignes?: Array<Record<string, unknown>>;
}

interface ScenarioEnMemoire {
  fil?: Array<{ role: "user" | "assistant"; contenu: string }>;
  contexte?: ContexteBrutSimule;
  fragments?: FragmentDeDroit[];
  parametres?: ParametreFiscal[];
  editionsPlusRecentes?: Array<{
    corpus: string;
    numero: string;
    validFrom: string;
    langue: string;
  }>;
  /** Ce que `conseil.contexte` rend : le cabinet mandaté, et si l'appelant est membre. */
  cabinet?: { appelantMembre: boolean; cabinetId: string | null };
}

interface ApiEnMemoire {
  api: AppelApi;
  /** Chaque RPC, dans l'ordre, avec ses arguments. */
  appels: Array<{ rpc: string; args: unknown[] }>;
  /** Le premier argument du premier appel à cette RPC. */
  premierArgument(rpc: string): unknown;
}

/** L'organisation de l'API en mémoire. */
export const TENANT_SIMULE = "00000000-0000-4000-8000-000000000011";

/**
 * L'API de Malica en mémoire : chaque dépôt que `askMalica` touche, rendant ce
 * que le scénario pose. C'est la forme de `c03-c04-unitaire.mjs` (constats 3 et
 * 4), devenue réutilisable.
 */
export function apiEnMemoire(scenario: ScenarioEnMemoire = {}): ApiEnMemoire {
  const appels: Array<{ rpc: string; args: unknown[] }> = [];
  const c = scenario.contexte ?? {};
  const api: AppelApi = {
    async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
      const rpc = `${depot}.${methode}`;
      appels.push({ rpc, args });
      const rendre = (v: unknown) => v as T;
      switch (rpc) {
        case "conseil.exigerBudget":
          return rendre({ depense: "0", plafond: "10" });
        case "conversations.ouvrirNouvelle":
          return rendre({ id: "fil-neuf" });
        case "conversations.ouvrir":
          return rendre(scenario.fil ?? []);
        case "capture.contexteAssistant":
          return rendre({
            organisation: {
              name: "ESSAI",
              kind: "pme",
              jurisdiction: "TN",
              // Une devise fictive : le code de production ne nomme aucune devise (R12).
              currency: "DEVISE-SIMULEE",
              validationMode: "autonome",
            },
            pack: null,
            fiche: c.fiche === undefined ? null : c.fiche,
            pieces: c.pieces ?? [],
            ecritures: c.ecritures ?? [],
            lignes: c.lignes ?? [],
            echeances: [],
            motifs: [],
            roles: [],
            sousComptes: [],
            tiers: [],
            piece: null,
          });
        case "corpus.modeleEmpreinte":
          return rendre({ model: "encodeur-simule", dimensions: 4 });
        case "corpus.rechercher":
          return rendre(scenario.fragments ?? []);
        case "corpus.parametresPour":
          return rendre(scenario.parametres ?? []);
        case "corpus.editionsPlusRecentes":
          return rendre(scenario.editionsPlusRecentes ?? []);
        case "capture.journaliserAgent":
          return rendre("run-simule");
        case "conseil.contexte":
          return rendre(scenario.cabinet ?? { appelantMembre: true, cabinetId: null });
        case "conversations.dernierMessage":
          return rendre({ id: "message-simule" });
        case "conseil.creer":
          return rendre({ id: "arbitrage-simule", cabinetId: scenario.cabinet?.cabinetId });
        case "identite.listMyOrganizations":
          return rendre([{ id: TENANT_SIMULE, jurisdiction: "TN" }]);
        case "conseil.nomsDesCorpus":
          return rendre({});
        case "conversations.ajouter":
        case "conversations.journaliserControles":
        case "conversations.renommer":
          return rendre(undefined);
        default:
          throw new Error(`RPC inattendue : ${rpc}`);
      }
    },
    async contenu() {
      throw new Error("aucune pièce dans le chat simulé");
    },
  };
  return {
    api,
    appels,
    premierArgument: (rpc) => appels.find((a) => a.rpc === rpc)?.args[0],
  };
}
