/**
 * « Parler à Malica » — la boucle d'agent.
 *
 * ================================================================ LE GESTE
 *
 *   1. le dossier est-il bien le sien, a-t-il une juridiction (R4), le plafond
 *      du mois permet-il un appel (ANO-029) — avant d'ouvrir le flux ;
 *   2. la chaîne de la plateforme (#274) dit qui peut répondre : Claude si son
 *      budget n'est pas épuisé et sa clé posée, sinon le repli DeepSeek, sinon
 *      l'arrêt — un message honnête, aucun appel ;
 *   3. la configuration se lit en base : consigne versionnée, modèles, effort,
 *      réflexion, tours d'outils (R8, R10) ; Haiku par défaut, Sonnet si la
 *      question l'exige ;
 *   4. Claude répond EN FLUX. Il appelle les outils du dossier (lecture seule,
 *      sous la RLS de la personne) ; leurs résultats lui reviennent en blocs
 *      citables ; la boucle continue tant qu'il appelle un outil, dans la
 *      limite réglée ;
 *   5. chaque phrase passe la garde des chiffres (`garde.ts`) avant l'écran ;
 *   6. une action qui modifie est PROPOSÉE (bouton), jamais exécutée ;
 *   7. l'échange se range dans le fil, l'appel se journalise au tarif de la
 *      base, et la fin porte sources, suggestions, coût et latence.
 *
 * ================================================================ LE CACHE
 *
 * Les définitions d'outils puis la consigne sont identiques d'un appel à
 * l'autre : un point de cache sur le dernier outil, un sur la consigne. Le
 * contexte du jour (date, dossier, langue) vient APRÈS, hors cache. Et le
 * cache automatique de l'API (`cache_control` au premier niveau) suit la
 * conversation qui grandit pendant la boucle d'outils : chaque tour relit le
 * précédent au dixième du prix (docs « Prompt caching », 8 novembre 2026).
 *
 * Tout ce qui parle au monde est injecté : la boucle se juge sans réseau.
 */

import { texte as message } from "@malica/socle/conseil";
import type {
  EvenementDeLAssistant,
  FinDeLaReponse,
  PropositionDAction,
  SourceDeLAssistant,
  SuggestionDeSuite,
} from "@malica/socle/ports/assistant";
import type { MessageKey } from "@malica/socle/messages";

import type { AppelApi } from "../appel-local.ts";
import { coutDeLAppel, type UsageDeLAppel } from "../conseil/cite.ts";
import type { ResultatDuConseilCite } from "../conseil/conseil-cite.ts";
import { lireLaChaine } from "../lecture/designation.ts";
import { Assembleur, type BlocBrut, type ClientEnFlux } from "./claude-flux.ts";
import {
  choisirLeModele,
  lireConfigurationAssistant,
  type ConfigurationDeLAssistant,
} from "./configuration.ts";
import { GardeDesChiffres, type SourceConnue } from "./garde.ts";
import { DEFINITIONS, executerOutil, type ContexteDesOutils } from "./outils.ts";

/** Le nom de l'organe au journal des agents. */
export const AGENT_ASSISTANT = "malica.assistant";

export interface ReponseDeRepli {
  answer: string;
  model: string;
  conversationId: string;
  messageId: string | null;
  titre: string | null;
  /** Ce que le repli avait sous les yeux : la garde y relit ses chiffres. */
  sources: SourceConnue[];
}

export interface DependancesDeLAssistant {
  /** Claude en flux ; `null` quand la clé n'est pas posée. */
  claude: ClientEnFlux | null;
  /** Le conseil cité (#278), pour l'outil `conseil_fiscal`. */
  conseil: (question: string, jour: string | null) => Promise<ResultatDuConseilCite>;
  /** Le repli : l'ancienne conversation DeepSeek (`askMalica`). */
  repli: (input: { question: string; conversationId: string | null }) => Promise<ReponseDeRepli>;
  maintenant?: () => number;
  aujourdhui?: () => string;
  idProposition?: () => string;
}

export interface QuestionPosee {
  tenantId: string;
  question: string;
  locale: "fr" | "en" | "ar";
  conversationId: string | null;
  pieceIds: string[];
}

/** Ce qui est vérifié AVANT d'ouvrir le flux : un refus part en 4xx, pas dans un flux. */
export interface DossierVerifie {
  organisation: {
    id: string;
    name: string;
    kind: string;
    jurisdiction: string;
    currency: string;
    role: string;
  };
}

export function aujourdhuiATunis(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tunis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(maintenant);
}

/** Le dossier est-il le sien, a-t-il une juridiction, le plafond le permet-il. */
export async function verifierLeDossier(api: AppelApi, tenantId: string): Promise<DossierVerifie> {
  const organisations = await api.rpc<DossierVerifie["organisation"][]>(
    "identite",
    "listMyOrganizations",
    [],
  );
  const organisation = organisations.find((o) => o.id === tenantId);
  if (!organisation) throw new Error("organisation introuvable ou non autorisée");
  // R4 : aucune juridiction par défaut.
  if (!organisation.jurisdiction) throw new Error("assistant.juridiction_absente");
  await api.rpc("conseil", "exigerBudget", [tenantId]);
  return { organisation };
}

const LANGUES: Record<string, string> = { fr: "français", en: "anglais", ar: "arabe" };

/** Le contexte du jour : hors cache, parce qu'il change. Aucun chiffre du dossier ici. */
function contexteDuJour(d: DossierVerifie, locale: string, aujourdhui: string): string {
  const o = d.organisation;
  return [
    `Aujourd'hui : ${aujourdhui} (heure de Tunis).`,
    `Dossier ouvert : « ${o.name} » (${o.kind === "cabinet" ? "cabinet d'expertise comptable" : "société"}), juridiction ${o.jurisdiction}, devise ${o.currency}.`,
    `La personne qui parle y a le rôle : ${o.role}.`,
    `Langue de l'interface : ${LANGUES[locale] ?? LANGUES["fr"]}. Réponds dans la langue du message de la personne.`,
  ].join("\n");
}

/** Le titre d'un fil neuf : le début de la question, coupé sur un mot. Aucun appel. */
function titreDuFil(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length <= 60) return q;
  const coupe = q.slice(0, 60);
  return `${coupe.slice(0, Math.max(coupe.lastIndexOf(" "), 30))}…`;
}

const SUITES: ReadonlyArray<{ cle: MessageKey; outil: string }> = [
  { cle: "pme.assistant.suite.aTraiter", outil: "pieces_chercher" },
  { cle: "pme.assistant.suite.tva", outil: "tva_du_mois" },
  { cle: "pme.assistant.suite.echeances", outil: "echeances_fiscales" },
  { cle: "pme.assistant.suite.ecritures", outil: "ecritures_proposees" },
  { cle: "pme.assistant.suite.textes", outil: "conseil_fiscal" },
];

/**
 * Les suggestions de suite : déterministes, sans appel ni chiffre — ce que
 * Malica n'a pas encore regardé dans ce tour, dans la langue de la personne.
 */
export function suggestionsDeSuite(outils: readonly string[], locale: string): SuggestionDeSuite[] {
  return SUITES.filter((s) => !outils.includes(s.outil))
    .slice(0, 3)
    .map((s) => ({ texte: message(locale, s.cle) }));
}

function versSourceAffichee(s: SourceConnue): SourceDeLAssistant {
  const { texte, ...reste } = s;
  // Ce que la source a remis au modèle, que l'écran déplie au clic — sans les
  // identifiants techniques, qui ne regardent que les outils.
  const extrait = texte
    .split("\n")
    .filter((l) => !l.startsWith("Identifiant (pour les outils"))
    .join("\n")
    .slice(0, 1500);
  return { ...reste, extrait };
}

/** Un résultat d'outil en blocs citables (docs « Search results », 8 novembre 2026). */
function blocDeRecherche(s: SourceConnue) {
  const paragraphes = s.texte
    .split(/\n{2,}|\n(?=- )/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "search_result" as const,
    source: s.cle,
    title: s.titre,
    content: (paragraphes.length > 0 ? paragraphes : [s.titre]).map((t) => ({
      type: "text" as const,
      text: t,
    })),
    citations: { enabled: true },
  };
}

/**
 * Le contenu d'un tour de Claude, tel qu'on le lui renvoie. Les blocs de
 * réflexion reviennent intacts (avec leur signature) ; les citations des blocs
 * de texte ne sont pas renvoyées — elles désignent des résultats que le
 * modèle a déjà, et la forme d'un tour renvoyé n'en a pas besoin.
 */
function tourARenvoyer(content: readonly BlocBrut[]): BlocBrut[] {
  return content
    .filter((b) => !(b.type === "text" && !(b as { text: string }).text))
    .map((b) => (b.type === "text" ? { type: "text", text: (b as { text: string }).text } : b));
}

const USAGE_NUL: UsageDeLAppel = { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 };

async function journaliser(
  api: AppelApi,
  input: {
    tenantId: string;
    modele: string;
    usage: UsageDeLAppel;
    latencyMs: number;
    erreur: string | null;
  },
): Promise<void> {
  const lignes: Array<{ role: string; tokensIn: number; tokensOut: number }> = [
    { role: "chat", tokensIn: input.usage.entree, tokensOut: input.usage.sortie },
  ];
  if (input.usage.cacheLu > 0)
    lignes.push({ role: "cache", tokensIn: input.usage.cacheLu, tokensOut: 0 });
  if (input.usage.cacheEcrit > 0) {
    lignes.push({ role: "cache_ecriture", tokensIn: input.usage.cacheEcrit, tokensOut: 0 });
  }
  for (const l of lignes) {
    await api
      .rpc("capture", "journaliserAgent", [
        {
          tenantId: input.tenantId,
          agent: AGENT_ASSISTANT,
          model: input.modele,
          role: l.role,
          status: input.erreur ? "error" : "ok",
          latencyMs: l.role === "chat" ? input.latencyMs : 0,
          tokensIn: l.tokensIn,
          tokensOut: l.tokensOut,
          pieceId: null,
          erreur: input.erreur ? input.erreur.slice(0, 500) : null,
        },
      ])
      .catch(() => null);
  }
}

/** Une panne de Claude AVANT tout mot montré : le repli peut encore répondre. */
class PanneAvantLePremierMot extends Error {
  readonly conversationId: string;
  constructor(message: string, conversationId: string) {
    super(message);
    this.conversationId = conversationId;
  }
}

/**
 * La conversation, de la question à la fin. `emettre` reçoit chaque
 * événement au fil de l'eau ; la fin est aussi rendue.
 */
export async function converser(
  api: AppelApi,
  dossier: DossierVerifie,
  q: QuestionPosee,
  deps: DependancesDeLAssistant,
  emettre: (ev: EvenementDeLAssistant) => void,
): Promise<FinDeLaReponse> {
  const maintenant = deps.maintenant ?? (() => Date.now());
  const debut = maintenant();
  const aujourdhui = (deps.aujourdhui ?? (() => aujourdhuiATunis()))();

  /* --------------------------------------------------- qui peut répondre (#274) */
  const chaine = lireLaChaine(await api.rpc<unknown>("capture", "chaineDeDesignation", []));
  const anthropic = chaine.find((m) => m.fournisseur === "anthropic");
  const deepseek = chaine.find((m) => m.fournisseur === "deepseek");
  const claudePossible = Boolean(deps.claude && anthropic && !anthropic.epuise);
  const repliPossible = Boolean(deepseek && !deepseek.epuise);

  if (!claudePossible) {
    return repliPossible
      ? repondreParLeRepli(q, deps, emettre, debut, maintenant)
      : sArreter(api, q, emettre, debut, maintenant);
  }

  const configuration: ConfigurationDeLAssistant = lireConfigurationAssistant(
    await api.rpc<unknown>("conseil", "configurationAssistant", []),
  );
  const reglage = configuration.reglage;
  const choix = choisirLeModele(q.question, q.pieceIds.length, reglage);

  const conversationId =
    q.conversationId ??
    (await api.rpc<{ id: string }>("conversations", "ouvrirNouvelle", [q.tenantId])).id;
  const passe = await api.rpc<Array<{ role: "user" | "assistant"; contenu: string }>>(
    "conversations",
    "ouvrir",
    [conversationId],
  );
  emettre({ type: "debut", conversationId, modele: choix.modele });

  const garde = new GardeDesChiffres(q.question);
  let premierMot: number | null = null;
  const envoyerTexte = (t: string) => {
    if (!t) return;
    if (premierMot === null && t.trim()) premierMot = maintenant() - debut;
    emettre({ type: "texte", texte: t });
  };

  const ctx: ContexteDesOutils = {
    api,
    tenantId: q.tenantId,
    locale: q.locale,
    organisation: dossier.organisation,
    aujourdhui,
    conseil: deps.conseil,
    idProposition: deps.idProposition ?? (() => crypto.randomUUID()),
  };

  /* ------------------------------------------------------------ la requête */
  const outils = DEFINITIONS.map((d, i) =>
    i === DEFINITIONS.length - 1 ? { ...d, cache_control: { type: "ephemeral" as const } } : d,
  );
  const system = [
    { type: "text", text: configuration.consigne.texte, cache_control: { type: "ephemeral" } },
    { type: "text", text: contexteDuJour(dossier, q.locale, aujourdhui) },
  ];
  const historique = passe.slice(-2 * reglage.tours_transmis);
  while (historique[0]?.role === "assistant") historique.shift();
  const jointes =
    q.pieceIds.length > 0
      ? `\n\n[Pièces jointes à ce message, lues par la lecture Malica — ouvre-les avec piece_ouvrir : ${q.pieceIds.join(", ")}]`
      : "";
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...historique.map((m) => ({ role: m.role, content: m.contenu })),
    { role: "user", content: `${q.question}${jointes}` },
  ];

  const outilsAppeles: string[] = [];
  const propositions: PropositionDAction[] = [];
  const mentions: string[] = [];
  let usageTotal: UsageDeLAppel = { ...USAGE_NUL };
  let coutTotal: number | null = 0;
  let modeleRendu: string = choix.modele;
  let iterations = 0;
  let interrompue: string | null = null;

  for (let tour = 0; tour < reglage.iterations_max; tour += 1) {
    iterations = tour + 1;
    const dernier = tour === reglage.iterations_max - 1;
    const requete: Record<string, unknown> = {
      model: choix.modele,
      max_tokens: reglage.sortie_max_jetons,
      output_config: { effort: choix.effort },
      thinking: { type: choix.reflexion },
      cache_control: { type: "ephemeral" },
      tools: outils,
      ...(dernier ? { tool_choice: { type: "none" } } : {}),
      system,
      messages,
    };

    const assembleur = new Assembleur();
    const blocsDeTexte = new Set<number>();
    const debutAppel = maintenant();
    garde.nouveauTour();
    try {
      for await (const ev of deps.claude!(requete)) {
        assembleur.recevoir(ev);
        const i = ev.index;
        if (ev.type === "content_block_start" && typeof i === "number") {
          if (ev.content_block?.type === "text") {
            blocsDeTexte.add(i);
            garde.ouvrirBloc();
          } else if (ev.content_block?.type === "tool_use") {
            emettre({
              type: "outil",
              nom: String((ev.content_block as { name?: string }).name),
              etat: "debut",
            });
          }
        } else if (
          ev.type === "content_block_delta" &&
          typeof i === "number" &&
          blocsDeTexte.has(i)
        ) {
          if (ev.delta?.type === "text_delta") {
            envoyerTexte(garde.recevoirTexte(ev.delta.text ?? ""));
          } else if (ev.delta?.type === "citations_delta" && ev.delta.citation) {
            garde.recevoirCitation(ev.delta.citation);
          }
        } else if (
          ev.type === "content_block_stop" &&
          typeof i === "number" &&
          blocsDeTexte.has(i)
        ) {
          const j = garde.fermerBloc();
          envoyerTexte(j.aEmettre);
          for (const phrase of j.retirees) emettre({ type: "retire", phrase });
        }
      }
    } catch (e) {
      const m = assembleur.message();
      await journaliser(api, {
        tenantId: q.tenantId,
        modele: choix.modele,
        usage: m.usage,
        latencyMs: maintenant() - debutAppel,
        erreur: e instanceof Error ? e.message : String(e),
      });
      if (tour === 0 && garde.texteEmis() === "" && repliPossible)
        throw new PanneAvantLePremierMot(String(e), conversationId);
      interrompue = e instanceof Error ? e.message : String(e);
      break;
    }

    const m = assembleur.message();
    modeleRendu = m.model ?? choix.modele;
    await journaliser(api, {
      tenantId: q.tenantId,
      modele: choix.modele,
      usage: m.usage,
      latencyMs: maintenant() - debutAppel,
      erreur: null,
    });
    usageTotal = {
      entree: usageTotal.entree + m.usage.entree,
      sortie: usageTotal.sortie + m.usage.sortie,
      cacheLu: usageTotal.cacheLu + m.usage.cacheLu,
      cacheEcrit: usageTotal.cacheEcrit + m.usage.cacheEcrit,
    };
    const cout = coutDeLAppel(choix.modele, m.usage, configuration.tarifs);
    coutTotal = coutTotal === null || cout === null ? null : coutTotal + cout;

    if (m.stopReason !== "tool_use") break;

    const appels = m.content.filter((b) => b.type === "tool_use") as Array<{
      id: string;
      name: string;
      input: unknown;
    }>;
    const resultats: unknown[] = [];
    for (const appel of appels) {
      outilsAppeles.push(appel.name);
      const r = await executerOutil(ctx, appel.name, appel.input);
      emettre({ type: "outil", nom: appel.name, etat: "fin" });
      if (!r.ok) {
        resultats.push({
          type: "tool_result",
          tool_use_id: appel.id,
          content: r.erreur,
          is_error: true,
        });
        continue;
      }
      for (const s of r.sources) garde.ajouterSource(s);
      resultats.push({
        type: "tool_result",
        tool_use_id: appel.id,
        content: r.sources.map(blocDeRecherche),
      });
      for (const p of r.propositions ?? []) {
        propositions.push(p);
        emettre({ type: "proposition", proposition: p });
      }
      if (r.mention) mentions.push(r.mention);
      if (r.coutUsd !== undefined) {
        coutTotal = coutTotal === null || r.coutUsd === null ? null : coutTotal + r.coutUsd;
      }
    }
    messages.push({ role: "assistant", content: tourARenvoyer(m.content) });
    messages.push({ role: "user", content: resultats });
  }

  /* ------------------------------------------------------------ la fin */
  // La mention « En vigueur au … » est composée par le code du conseil cité,
  // jamais par le modèle : elle part telle quelle, après la garde.
  const dite = garde.texteEmis();
  const ajouts: string[] = [];
  const mentionsUniques = [...new Set(mentions)];
  if (mentionsUniques.length > 0) ajouts.push(mentionsUniques.map((x) => `_${x}_`).join("\n"));
  if (interrompue) {
    ajouts.push(
      message(q.locale, dite ? "pme.assistant.interrompue" : "pme.assistant.indisponible"),
    );
  } else if (!dite) {
    ajouts.push(message(q.locale, "pme.assistant.vide"));
  }
  for (const [k, a] of ajouts.entries()) envoyerTexte(dite || k > 0 ? `\n\n${a}` : a);
  const reponse = [dite, ...ajouts].filter(Boolean).join("\n\n");

  const latenceTotale = maintenant() - debut;
  await api.rpc<void>("conversations", "ajouter", [
    {
      conversationId,
      question: q.question,
      reponse,
      model: modeleRendu,
      tokensIn: usageTotal.entree + usageTotal.cacheLu + usageTotal.cacheEcrit,
      tokensOut: usageTotal.sortie,
      latencyMs: latenceTotale,
    },
  ]);
  const dernierMessage = await api
    .rpc<{ id: string } | null>("conversations", "dernierMessage", [conversationId])
    .catch(() => null);
  let titre: string | null = null;
  if (passe.length === 0) {
    titre = titreDuFil(q.question);
    await api.rpc<void>("conversations", "renommer", [{ conversationId, titre }]).catch(() => {
      titre = null;
    });
  }

  const fin: FinDeLaReponse = {
    conversationId,
    messageId: dernierMessage?.id ?? null,
    titre,
    reponse,
    sources: garde
      .sourcesCitees()
      .filter((s) => !s.cle.startsWith("malica:proposition:"))
      .map(versSourceAffichee),
    propositions,
    suggestions: suggestionsDeSuite(outilsAppeles, q.locale),
    chiffresRetires: garde.retirees(),
    mesure: {
      modele: modeleRendu,
      repli: null,
      latencePremierMotMs: premierMot,
      latenceTotaleMs: latenceTotale,
      coutUsd: coutTotal === null ? null : Math.round(coutTotal * 1_000_000) / 1_000_000,
      outils: outilsAppeles,
      iterations,
    },
  };
  emettre({ type: "fin", fin });
  return fin;
}

/**
 * La conversation entière, repli compris : si Claude tombe avant d'avoir dit
 * un mot, DeepSeek reprend la question (« pour ne pas s'arrêter », #274).
 */
export async function converserAvecRepli(
  api: AppelApi,
  dossier: DossierVerifie,
  q: QuestionPosee,
  deps: DependancesDeLAssistant,
  emettre: (ev: EvenementDeLAssistant) => void,
): Promise<FinDeLaReponse> {
  try {
    return await converser(api, dossier, q, deps, emettre);
  } catch (e) {
    if (!(e instanceof PanneAvantLePremierMot)) throw e;
    const maintenant = deps.maintenant ?? (() => Date.now());
    return repondreParLeRepli(
      { ...q, conversationId: e.conversationId },
      deps,
      emettre,
      maintenant(),
      maintenant,
    );
  }
}

async function repondreParLeRepli(
  q: QuestionPosee,
  deps: DependancesDeLAssistant,
  emettre: (ev: EvenementDeLAssistant) => void,
  debut: number,
  maintenant: () => number,
): Promise<FinDeLaReponse> {
  const r = await deps.repli({ question: q.question, conversationId: q.conversationId });
  emettre({ type: "debut", conversationId: r.conversationId, modele: r.model });
  // Le repli ne cite pas en flux : sa réponse entière passe la même garde, contre
  // ce qu'il avait sous les yeux.
  const garde = new GardeDesChiffres(q.question);
  for (const s of r.sources) garde.ajouterSource(s);
  const jugement = garde.jugerTout(r.answer);
  const reponse = garde.texteEmis() || message(q.locale, "pme.assistant.vide");
  const premierMot = maintenant() - debut;
  emettre({ type: "texte", texte: reponse });
  for (const phrase of jugement.retirees) emettre({ type: "retire", phrase });
  const fin: FinDeLaReponse = {
    conversationId: r.conversationId,
    messageId: r.messageId,
    titre: r.titre,
    reponse,
    sources: [],
    propositions: [],
    suggestions: suggestionsDeSuite([], q.locale),
    chiffresRetires: garde.retirees(),
    mesure: {
      modele: r.model,
      repli: "deepseek",
      latencePremierMotMs: premierMot,
      latenceTotaleMs: maintenant() - debut,
      coutUsd: null,
      outils: [],
      iterations: 1,
    },
  };
  emettre({ type: "fin", fin });
  return fin;
}

/** Les deux budgets épuisés : aucun appel, un message honnête, le fil garde l'échange. */
async function sArreter(
  api: AppelApi,
  q: QuestionPosee,
  emettre: (ev: EvenementDeLAssistant) => void,
  debut: number,
  maintenant: () => number,
): Promise<FinDeLaReponse> {
  const conversationId =
    q.conversationId ??
    (await api.rpc<{ id: string }>("conversations", "ouvrirNouvelle", [q.tenantId])).id;
  emettre({ type: "debut", conversationId, modele: null });
  const reponse = message(q.locale, "pme.assistant.arret");
  emettre({ type: "texte", texte: reponse });
  await api.rpc<void>("conversations", "ajouter", [
    { conversationId, question: q.question, reponse, model: null, latencyMs: 0 },
  ]);
  const fin: FinDeLaReponse = {
    conversationId,
    messageId: null,
    titre: null,
    reponse,
    sources: [],
    propositions: [],
    suggestions: [],
    chiffresRetires: [],
    mesure: {
      modele: null,
      repli: "arret",
      latencePremierMotMs: maintenant() - debut,
      latenceTotaleMs: maintenant() - debut,
      coutUsd: 0,
      outils: [],
      iterations: 0,
    },
  };
  emettre({ type: "fin", fin });
  return fin;
}
