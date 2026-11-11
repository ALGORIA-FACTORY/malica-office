/**
 * DeepSeek dans la même boucle d'outils que Claude.
 *
 * ============================================================== POURQUOI
 *
 * Le chemin de repli (`askMalica`) lisait un instantané du dossier et rendait
 * sa réponse d'un bloc : sur la même question, la même minute, DeepSeek disait
 * « 23 pièces à lire » quand Claude disait « 114 pièces en attente » (lot A,
 * `docs/validation-chat-malica/lot-a-parite.md`). Deux moteurs qui ne
 * regardent pas les mêmes données ne donnent pas le même résultat.
 *
 * Le point d'accès au format Messages de DeepSeek parle le même flux que
 * Claude (mesuré le 10 novembre 2026 : `message_start`, `content_block_*`,
 * `tool_use`, `input_json_delta`). La boucle de `agent.ts` n'a donc qu'à lui
 * parler de la même façon : mêmes outils, même garde des chiffres, même
 * consigne.
 *
 * ================================================== CE QUE DEEPSEEK NE FAIT PAS
 *
 * Il n'a ni citations natives, ni blocs `search_result`, ni cache. Cet
 * adaptateur comble l'écart sans toucher à la boucle :
 *
 *  - à l'aller, un `search_result` devient un passage numéroté `[S1]`, `[S2]`…
 *    (l'ordre est celui où la garde a reçu les sources : c'est son index) ;
 *  - au retour, le marqueur que le modèle écrit en fin de phrase est RETIRÉ
 *    du texte et devient une `citations_delta` — la même que celle de Claude,
 *    que la garde relit à l'identique. Le passage cité est celui des
 *    paragraphes de la source qui portent les chiffres de la phrase : une
 *    phrase chiffrée dont la source ne porte pas le chiffre n'a pas de
 *    justificatif, et la garde la retire.
 *
 * La réflexion de DeepSeek n'est jamais relayée : ses blocs `thinking` sont
 * écartés ici (R : le raisonnement ne part jamais).
 *
 * La clé est `DEEPSEEK_API_KEY`, côté serveur seulement ; `fetch` est
 * injectable, aucune épreuve n'appelle le réseau.
 */

import { type ClientEnFlux, type EvenementClaude, lireLeFluxSSE } from "./claude-flux.ts";
import { chiffresDe } from "./garde.ts";

/** Le point d'accès au format Messages de DeepSeek (relevé le 10 novembre 2026). */
const DEEPSEEK_MESSAGES_URL = "https://api.deepseek.com/anthropic/v1/messages";

/** Un passage remis au modèle : la clé de la source et ses paragraphes. */
export interface Passage {
  cle: string;
  titre: string;
  paragraphes: string[];
}

interface RequeteAdaptee {
  corps: Record<string, unknown>;
  /** Dans l'ordre où le modèle les reçoit : `[S1]` est `passages[0]`. */
  passages: Passage[];
}

const SANS_CACHE = (valeur: unknown): unknown => {
  if (Array.isArray(valeur)) return valeur.map(SANS_CACHE);
  if (valeur && typeof valeur === "object") {
    const sortie: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
      if (k === "cache_control") continue;
      sortie[k] = SANS_CACHE(v);
    }
    return sortie;
  }
  return valeur;
};

interface ResultatDeRecherche {
  type: "search_result";
  source: string;
  title: string;
  content: Array<{ type: string; text?: string }>;
}

const estUneRecherche = (b: unknown): b is ResultatDeRecherche =>
  Boolean(b) && typeof b === "object" && (b as { type?: unknown }).type === "search_result";

/**
 * La requête de Claude, mise au format que DeepSeek accepte : sans cache, sans
 * réflexion réglée pour Claude, la consigne en un seul texte, et chaque
 * `search_result` d'un résultat d'outil devenu un passage numéroté.
 */
export function adapterLaRequete(requete: Record<string, unknown>): RequeteAdaptee {
  const passages: Passage[] = [];
  const {
    output_config: _effort,
    thinking: _reflexion,
    cache_control: _cache,
    system,
    messages,
    ...reste
  } = requete;
  void _effort;
  void _reflexion;
  void _cache;

  const consigne = Array.isArray(system)
    ? (system as Array<{ text?: string }>)
        .map((b) => b.text ?? "")
        .filter(Boolean)
        .join("\n\n")
    : typeof system === "string"
      ? system
      : "";

  const adaptes = (Array.isArray(messages) ? messages : []).map((m) => {
    const message = m as { role: string; content: unknown };
    if (!Array.isArray(message.content)) return message;
    const contenu = message.content.map((bloc) => {
      const b = bloc as { type?: string; content?: unknown };
      if (b.type !== "tool_result" || !Array.isArray(b.content)) return bloc;
      const textes = b.content.map((c) => {
        if (!estUneRecherche(c)) return String((c as { text?: unknown }).text ?? "");
        const paragraphes = c.content.map((p) => p.text ?? "").filter(Boolean);
        passages.push({ cle: c.source, titre: c.title, paragraphes });
        return `[S${passages.length}] ${c.title}\n${paragraphes.join("\n")}`;
      });
      return { ...b, content: textes.join("\n\n") };
    });
    return { ...message, content: contenu };
  });

  return {
    corps: SANS_CACHE({
      ...reste,
      // Sa réflexion ne revient jamais (elle n'est pas relayée) : or DeepSeek exige
      // de la recevoir en retour dès qu'il réfléchit — mesuré le 10 novembre 2026
      // sur deepseek-flash, qui réfléchit par défaut. Elle est donc coupée.
      thinking: { type: "disabled" },
      ...(consigne ? { system: consigne } : {}),
      messages: adaptes,
    }) as Record<string, unknown>,
    passages,
  };
}

/** `[S1]`, `[S1, S3]`, `[S1][S2]` — le marqueur que le modèle écrit en fin de phrase. */
const MARQUEUR = /\[S(\d+(?:\s*[,;]\s*S?\d+)*)\]/g;
/** Un marqueur peut arriver coupé, et l'espace qui le précède avec lui : on garde les deux pour le morceau suivant. */
const MARQUEUR_ENTAME = /[ \t]*(?:\[S?[\d\s,;S]*|<[｜|]*(?:D(?:S(?:M(?:L)?)?)?)?)?$/;
const FIN_DE_PHRASE = /[.!?؟]\s+|\n+/;
/**
 * Un appel d'outil que DeepSeek écrit EN CLAIR dans son texte, dans son propre
 * balisage (`<｜｜DSML｜｜ calls>…`), au lieu de le rendre en bloc `tool_use` :
 * mesuré le 10 novembre 2026 sur deepseek-flash quand `tool_choice` vaut
 * `none`. Il porterait un nom d'outil à l'écran. Tout ce qui suit est coupé.
 */
const APPEL_EN_CLAIR = /<[｜|]{1,2}\s*DSML/;

interface BlocEnCours {
  /** Un appel d'outil écrit en clair a été vu : le reste du bloc est jeté. */
  coupe: boolean;
  /** Ce qui est arrivé et pas encore rendu (un marqueur peut s'y former). */
  retenu: string;
  /** La phrase en cours, sans ses marqueurs. */
  phrase: string;
  /** La phrase d'avant : un marqueur posé après le point la désigne. */
  precedente: string;
}

/**
 * Rend les événements de DeepSeek dans la forme de ceux de Claude : texte sans
 * marqueurs, citations de la garde, aucune réflexion. Pur : on lui donne les
 * événements et les passages, il rend des événements.
 */
export class TraducteurDeFlux {
  private readonly passages: readonly Passage[];
  private readonly blocs = new Map<number, BlocEnCours>();
  private readonly ecartes = new Set<number>();

  constructor(passages: readonly Passage[]) {
    this.passages = passages;
  }

  recevoir(ev: EvenementClaude): EvenementClaude[] {
    const i = ev.index;
    if (ev.type === "content_block_start" && typeof i === "number") {
      const type = ev.content_block?.type;
      if (type === "thinking" || type === "redacted_thinking") {
        this.ecartes.add(i);
        return [];
      }
      if (type === "text")
        this.blocs.set(i, { coupe: false, retenu: "", phrase: "", precedente: "" });
      return [ev];
    }
    if (typeof i === "number" && this.ecartes.has(i)) return [];

    if (ev.type === "content_block_delta" && typeof i === "number") {
      const bloc = this.blocs.get(i);
      if (bloc && ev.delta?.type === "text_delta") {
        return this.texte(i, bloc, ev.delta.text ?? "");
      }
      return [ev];
    }
    if (ev.type === "content_block_stop" && typeof i === "number") {
      const bloc = this.blocs.get(i);
      if (!bloc) return [ev];
      this.blocs.delete(i);
      const reste = bloc.retenu;
      bloc.retenu = "";
      const sortie = reste ? this.texte(i, bloc, reste, true) : [];
      return [...sortie, ev];
    }
    return [ev];
  }

  /** Un morceau de texte : on rend ce qui est sûr, on cite ce qui est marqué. */
  private texte(index: number, bloc: BlocEnCours, morceau: string, fin = false): EvenementClaude[] {
    if (bloc.coupe) return [];
    let tampon = bloc.retenu + morceau;
    bloc.retenu = "";
    const appel = APPEL_EN_CLAIR.exec(tampon);
    if (appel) {
      tampon = tampon.slice(0, appel.index).replace(/\s+$/, "");
      bloc.coupe = true;
    } else if (!fin) {
      const entame = MARQUEUR_ENTAME.exec(tampon);
      if (entame && entame[0] !== "") {
        bloc.retenu = entame[0];
        tampon = tampon.slice(0, entame.index);
      }
    }
    const sortie: EvenementClaude[] = [];
    let depuis = 0;
    const rendre = (texte: string) => {
      if (!texte) return;
      this.suivrePhrase(bloc, texte);
      sortie.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: texte },
      });
    };
    for (const m of tampon.matchAll(MARQUEUR)) {
      const avant = tampon.slice(depuis, m.index);
      depuis = (m.index ?? 0) + m[0].length;
      // « 342.000 TND [S1]. » : l'espace posé devant le marqueur ne reste pas
      // devant la ponctuation qui le suit.
      rendre(/^[\s.,;:!?،؟]/.test(tampon.slice(depuis)) ? avant.replace(/[ \t]+$/, "") : avant);
      const contexte = bloc.phrase.trim() || bloc.precedente.trim();
      for (const n of (m[1] ?? "").split(/[,;]/).map((x) => Number(x.replace(/\D/g, "")))) {
        const citation = this.citer(n, contexte);
        if (citation) {
          sortie.push({
            type: "content_block_delta",
            index,
            delta: { type: "citations_delta", citation },
          });
        }
      }
    }
    rendre(tampon.slice(depuis));
    return sortie;
  }

  private suivrePhrase(bloc: BlocEnCours, texte: string): void {
    for (const part of texte.split(new RegExp(`(${FIN_DE_PHRASE.source})`))) {
      if (!part) continue;
      if (FIN_DE_PHRASE.test(part)) {
        bloc.precedente = bloc.phrase + part;
        bloc.phrase = "";
      } else {
        bloc.phrase += part;
      }
    }
  }

  /**
   * La citation d'un marqueur. Le passage cité est celui des paragraphes de la
   * source qui portent un chiffre de la phrase ; sans chiffre dans la phrase,
   * le premier paragraphe. Un marqueur sans passage n'est pas une citation.
   */
  private citer(n: number, phrase: string): Record<string, unknown> | null {
    const passage = Number.isInteger(n) ? this.passages[n - 1] : undefined;
    if (!passage) return null;
    const chiffres = chiffresDe(phrase);
    const cites =
      chiffres.length === 0
        ? passage.paragraphes.slice(0, 1)
        : passage.paragraphes.filter((p) => chiffresDe(p).some((c) => chiffres.includes(c)));
    return {
      type: "search_result_location",
      source: passage.cle,
      cited_text: cites.join("\n"),
      search_result_index: n - 1,
    };
  }
}

class ErreurDeFlux extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ErreurDeFlux";
    this.status = status;
    this.retryable = retryable;
  }
}

/** DeepSeek en flux, au format de Claude : ce que la boucle d'outils appelle. */
export function clientDeepSeekEnFlux(input: {
  apiKey: string | undefined;
  fetch?: typeof fetch;
}): ClientEnFlux {
  return async function* (requete, options) {
    const cle = input.apiKey?.trim();
    if (!cle) throw new ErreurDeFlux("DEEPSEEK_API_KEY absente", 401, false);
    const { corps, passages } = adapterLaRequete(requete);
    let res: Response;
    try {
      res = await (input.fetch ?? fetch)(DEEPSEEK_MESSAGES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cle,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ ...corps, stream: true }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      throw new ErreurDeFlux(
        `DeepSeek inatteignable : ${cause instanceof Error ? cause.message : String(cause)}`,
        503,
        true,
      );
    }
    if (!res.ok || !res.body) {
      const texte = await res.text().catch(() => "");
      throw new ErreurDeFlux(
        `DeepSeek ${res.status} : ${texte.slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    const traducteur = new TraducteurDeFlux(passages);
    for await (const ev of lireLeFluxSSE(res.body)) {
      yield* traducteur.recevoir(ev);
    }
  };
}
