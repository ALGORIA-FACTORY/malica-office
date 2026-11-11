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
 *   7. le modèle conclut par l'outil final `conclure_reponse` : conseil ou
 *      non, portée, certitude, doute, thème ;
 *   8. l'échange se range dans le fil, l'appel se journalise au tarif de la
 *      base, et la fin porte sources et suggestions. La mesure (modèle, coût,
 *      latence, outils) reste au serveur : rien de la mécanique ne part au
 *      navigateur.
 *
 * ============================================================ LA RELECTURE
 *
 * La conversation DeepSeek (`askMalica`) fait relire par le cabinet mandaté
 * une réponse de conseil qui engage le dossier d'une PME : la PME lit « votre
 * comptable relit ma réponse », et la réponse attend dans la file du cabinet.
 * L'assistant tient la même règle, avec la même fonction (`doitEtreRelue`).
 *
 * Mais il parle en flux, et une réponse lâchée mot à mot ne se retient plus.
 * Donc, quand la règle PEUT retenir — la personne est membre de la PME, un
 * cabinet est engagé —, le texte gardé s'accumule sans partir : l'écran ne
 * reçoit que les étapes (« Je regarde vos pièces… »). À la conclusion, la règle
 * tranche : retenue, la PME ne lit que le message de relecture et la réponse
 * part dans la file (`conseil.creer`) ; sinon, la réponse part d'un bloc. Un
 * modèle qui ne conclut pas laisse une portée « incertaine » : retenue — le
 * défaut prudent qu'`askMalica` applique déjà à une réponse illisible.
 *
 * Sans cabinet engagé, ou quand le cabinet interroge lui-même le dossier,
 * rien ne peut être retenu : la réponse part en flux, comme avant.
 *
 * Le repli DeepSeek passe par `askMalica`, qui retient lui-même : l'agent n'y
 * ajoute rien — une réponse n'entre qu'une fois dans la file.
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
  BlocDeReponse,
  EvenementDeLAssistant,
  FinDeLaReponse,
  PropositionDAction,
  SourceDeLAssistant,
  SuggestionDeSuite,
} from "@malica/socle/ports/assistant";
import type { MessageKey } from "@malica/socle/messages";
import type { ContexteConseil, SourceCitee } from "@malica/socle/ports/repositories";

import type { AppelApi } from "../appel-local.ts";
import { coutDeLAppel, type UsageDeLAppel } from "../conseil/cite.ts";
import type { ResultatDuConseilCite } from "../conseil/conseil-cite.ts";
import { doitEtreRelue } from "../conseil/conseil.ts";
import { lireLaChaine } from "../lecture/designation.ts";
import { Assembleur, type BlocBrut, type ClientEnFlux } from "./claude-flux.ts";
import {
  choisirLeModele,
  lireConfigurationAssistant,
  type ConfigurationDeLAssistant,
} from "./configuration.ts";
import { chiffresDe, GardeDesChiffres, type CitationRecue, type SourceConnue } from "./garde.ts";
import { FiltreDeMecanique } from "./sans-mecanique.ts";
import {
  AFFICHER_VISUEL,
  COMPARER_LES_SOCIETES,
  CONCLURE_REPONSE,
  DEFINITIONS,
  etapeDeLOutil,
  executerOutil,
  lireLaConclusion,
  type ConclusionDeLaReponse,
  type ContexteDesOutils,
} from "./outils.ts";

/** Le nom de l'organe au journal des agents. */
const AGENT_ASSISTANT = "malica.assistant";

interface ReponseDeRepli {
  /** La réponse RANGÉE au fil — donc déjà passée par `garder`. */
  answer: string;
  model: string;
  conversationId: string;
  messageId: string | null;
  titre: string | null;
  /** `askMalica` a retenu la réponse pour le cabinet : `answer` est le message de relecture. */
  retenue?: boolean;
}

/** Pourquoi Claude ne répond pas : le motif reste dans la mesure, au serveur. */
type MotifDuRepli = "budget_claude" | "plafond_assistant" | "cle_absente" | "panne";

/**
 * La mesure d'une réponse — SERVEUR SEULEMENT. Elle sert le journal des coûts
 * et l'épreuve ; elle ne part jamais au navigateur (`versLEcran`).
 */
interface MesureDeLaReponse {
  modele: string | null;
  /** Le modèle de repli a répondu (`deepseek`), ou l'on s'est arrêté (`arret`). */
  repli: "deepseek" | "arret" | null;
  /** Pourquoi Claude n'a pas répondu ; `null` quand il a répondu. */
  motifDuRepli: MotifDuRepli | null;
  latencePremierMotMs: number | null;
  latenceTotaleMs: number;
  /** Au tarif de la base (R8) ; `null` si un tarif manque. */
  coutUsd: number | null;
  outils: string[];
  iterations: number;
  /** Ce que le modèle a conclu de sa réponse ; `null` s'il n'a pas conclu. */
  conclusion: ConclusionDeLaReponse | null;
  /** La réponse a été retenue pour le cabinet (par l'agent ou par `askMalica`). */
  retenue: boolean;
  /** La réponse est partie, marquée « à confirmer », et le cabinet l'a reçue ou non. */
  annoncee: boolean;
  /** Les phrases parties avec la marque « non vérifié » (le corpus n'avait pas répondu). */
  nonVerifies: number;
  /** Les annonces d'outil (« je regarde vos pièces ») que l'écran n'a pas reçues. */
  annoncesTues: number;
}

/** La fin telle que le serveur la connaît : ce que l'écran reçoit, plus la mesure. */
export interface FinMesuree extends FinDeLaReponse {
  mesure: MesureDeLaReponse;
}

/**
 * Ce qui part au navigateur, champ par champ : une liste blanche, pour qu'un
 * champ technique ajouté à la fin ne parte pas par mégarde.
 */
function versLEcran(f: FinMesuree): FinDeLaReponse {
  return {
    conversationId: f.conversationId,
    messageId: f.messageId,
    titre: f.titre,
    reponse: f.reponse,
    sources: f.sources,
    propositions: f.propositions,
    suggestions: f.suggestions,
    // Les blocs composés par le serveur : déjà formatés, déjà traduits, sans mécanique.
    blocs: f.blocs,
    chiffresRetires: f.chiffresRetires,
    sansCitations: f.sansCitations,
  };
}

/**
 * Ce que l'agent tient pour conclu quand le modèle n'a rien conclu (ou mal) :
 * du conseil à la portée incertaine, sans certitude — retenu si un cabinet
 * peut relire, comme `askMalica` le fait d'une réponse qu'il ne sait pas lire.
 */
/** Les noms d'outils : la garde tait toute phrase qui en porte un. */
const NOMS_DE_LA_MECANIQUE = [
  ...DEFINITIONS,
  COMPARER_LES_SOCIETES,
  AFFICHER_VISUEL,
  CONCLURE_REPONSE,
].map((d) => d.name);

/**
 * Les outils qui SUIVENT une réponse au lieu de la précéder : un visuel posé
 * sous le texte, un geste proposé, la conclusion. Le paragraphe écrit juste
 * avant eux est la réponse ; avant tout autre outil, c'est une annonce.
 */
const ACTION_PROPOSER = "action_proposer";
/** Un paragraphe fini, puis le début d'un autre. */
const SECOND_PARAGRAPHE = /\S[ \t]*\n\s*\n\s*\S/;
const SUITES_D_UNE_REPONSE: ReadonlySet<string> = new Set([
  AFFICHER_VISUEL.name,
  CONCLURE_REPONSE.name,
  ACTION_PROPOSER,
]);

/** Ce qu'on dit au modèle qui a répondu sans conclure. Aucun texte n'en sort à l'écran. */
const DEMANDE_DE_CONCLUSION =
  "Tu as répondu sans conclure. Appelle maintenant conclure_reponse pour la réponse que tu viens de donner, et rien d'autre.";

const SANS_CONCLUSION: ConclusionDeLaReponse = {
  conseil: true,
  portee: "incertaine",
  certitude: 0,
  doute: null,
  theme: null,
};

/** Les articles que la réponse cite, sous la forme que la file du cabinet range. */
function articlesCites(sources: readonly SourceConnue[]): SourceCitee[] {
  const vus = new Set<string>();
  const articles: SourceCitee[] = [];
  for (const s of sources) {
    if (s.genre !== "article" || !s.article?.numero) continue;
    const cle = `${s.article.corpus}|${s.article.numero}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    articles.push({
      corpus: s.article.corpus,
      numero: s.article.numero,
      validFrom: s.article.validFrom,
      validTo: null,
      langue: null,
    });
  }
  return articles;
}

export interface DependancesDeLAssistant {
  /** Claude en flux ; `null` quand la clé n'est pas posée. */
  claude: ClientEnFlux | null;
  /**
   * DeepSeek, dans la MÊME boucle d'outils que Claude (`deepseek-flux.ts`) :
   * mêmes outils, même garde, même consigne. Absent, le repli reste l'ancienne
   * conversation (`repli`), qui ne voit qu'un instantané du dossier.
   */
  deepseek?: ClientEnFlux | null;
  /** Le conseil cité (#278), pour l'outil `conseil_fiscal`. */
  conseil: (question: string, jour: string | null) => Promise<ResultatDuConseilCite>;
  /**
   * Le repli : l'ancienne conversation DeepSeek (`askMalica`, `repli.ts`). Il
   * DOIT passer sa réponse par `garder` avant de la ranger au fil, avec ce
   * que le modèle avait sous les yeux : le fil garde la version contrôlée.
   */
  repli: (input: {
    question: string;
    conversationId: string | null;
    garder: (reponse: string, sources: SourceConnue[]) => string;
  }) => Promise<ReponseDeRepli>;
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
  /** La personne regarde « Toutes les sociétés » : la comparaison lui est ouverte. */
  toutesLesSocietes?: boolean;
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
  /** Les sociétés de la personne (même genre que le dossier), la société ouverte en tête. */
  societes?: ReadonlyArray<{ id: string; name: string; currency: string }>;
}

function aujourdhuiATunis(maintenant: Date = new Date()): string {
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
  return {
    organisation,
    // Ses sociétés, telles que la base les lui reconnaît : c'est le seul périmètre
    // que « Toutes les sociétés » peut ouvrir. La société ouverte vient en premier.
    societes: organisations
      .filter((o) => o.kind === organisation.kind)
      .sort((a, b) => Number(b.id === tenantId) - Number(a.id === tenantId))
      .map((o) => ({ id: o.id, name: o.name, currency: o.currency })),
  };
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
function suggestionsDeSuite(outils: readonly string[], locale: string): SuggestionDeSuite[] {
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
async function converser(
  api: AppelApi,
  dossier: DossierVerifie,
  q: QuestionPosee,
  deps: DependancesDeLAssistant,
  emettre: (ev: EvenementDeLAssistant) => void,
  /** Claude est tombé avant son premier mot : DeepSeek reprend, dans la même boucle. */
  repriseApresPanne: boolean = false,
): Promise<FinMesuree> {
  const maintenant = deps.maintenant ?? (() => Date.now());
  const debut = maintenant();
  const aujourdhui = (deps.aujourdhui ?? (() => aujourdhuiATunis()))();

  /* --------------------------------------------------- qui peut répondre (#274) */
  const chaine = lireLaChaine(await api.rpc<unknown>("capture", "chaineDeDesignation", []));
  const anthropic = chaine.find((m) => m.fournisseur === "anthropic");
  const deepseek = chaine.find((m) => m.fournisseur === "deepseek");
  const repliPossible = Boolean(deepseek && !deepseek.epuise);

  // Claude ne répond que si sa clé est posée, si le budget commun de la chaîne
  // n'est pas épuisé ET si l'assistant n'a pas atteint SON plafond (décision
  // du dirigeant, 8 novembre 2026 : la lecture des pièces garde sa part).
  // Sinon DeepSeek répond DANS LA MÊME BOUCLE (mêmes outils, même garde) ; à
  // défaut de client DeepSeek, l'ancienne conversation prend le relais.
  let motif: MotifDuRepli | null = !deps.claude
    ? "cle_absente"
    : !anthropic || anthropic.epuise
      ? "budget_claude"
      : repriseApresPanne
        ? "panne"
        : null;
  const deepseekEnBoucle = Boolean(deps.deepseek && deepseek && !deepseek.epuise);
  let configuration: ConfigurationDeLAssistant | null = null;
  if (motif === null || deepseekEnBoucle) {
    configuration = lireConfigurationAssistant(
      await api.rpc<unknown>("conseil", "configurationAssistant", []),
    );
    if (motif === null && configuration.plafond.epuise) motif = "plafond_assistant";
  }
  const fournisseur: "claude" | "deepseek" | null =
    motif === null ? "claude" : deepseekEnBoucle && configuration ? "deepseek" : null;

  if (fournisseur === null || configuration === null) {
    const m = motif ?? "budget_claude";
    return repliPossible
      ? repondreParLeRepli(q, deps, emettre, debut, maintenant, m)
      : sArreter(api, q, emettre, debut, maintenant, m);
  }
  const client = fournisseur === "claude" ? deps.claude! : deps.deepseek!;

  const reglage = configuration.reglage;
  const choixClaude = choisirLeModele(q.question, q.pieceIds.length, reglage);
  // Le modèle de DeepSeek est celui que la chaîne règle (R8), jamais un nom en code.
  const choix =
    fournisseur === "deepseek" && deepseek
      ? { ...choixClaude, modele: deepseek.modele }
      : choixClaude;

  /*
   * La relecture du cabinet peut-elle retenir cette réponse ? Les conditions
   * de `doitEtreRelue` qui ne tiennent pas à la réponse elle-même — la
   * personne est membre, un cabinet est engagé — se jugent AVANT le premier
   * mot : une réponse de conseil à la portée incertaine serait-elle relue ?
   * Si oui, rien ne part avant la conclusion du modèle.
   */
  const contexte = await api
    .rpc<ContexteConseil>("conseil", "contexte", [q.tenantId])
    .catch(() => null);
  // En mode « annoncer », rien n'est retenu : la réponse part en flux, et
  // l'envoi au cabinet se dit à la fin.
  const enAttente =
    configuration.relecture === "retenir" && doitEtreRelue(SANS_CONCLUSION, contexte);

  const conversationId =
    q.conversationId ??
    (await api.rpc<{ id: string }>("conversations", "ouvrirNouvelle", [q.tenantId])).id;
  const passe = await api.rpc<Array<{ role: "user" | "assistant"; contenu: string }>>(
    "conversations",
    "ouvrir",
    [conversationId],
  );
  emettre({ type: "debut", conversationId });

  const garde = new GardeDesChiffres(q.question, configuration.garde);
  // Aucun nom d'outil ne part à l'écran, quoi que le modèle écrive.
  garde.taire(NOMS_DE_LA_MECANIQUE);
  let premierMot: number | null = null;
  // Le texte gardé s'accumule dans la garde (`texteEmis`) ; il ne part à
  // l'écran qu'en flux libre. En attente de la conclusion, il attend.
  let texteMontre = false;
  const montrer = (t: string) => {
    if (!t) return;
    if (premierMot === null && t.trim()) premierMot = maintenant() - debut;
    texteMontre = true;
    emettre({ type: "texte", texte: t });
  };
  const envoyerTexte = (t: string) => {
    if (!enAttente) montrer(t);
  };
  const etape = (nom: string, etat: "debut" | "fin") => {
    const etiquette = etapeDeLOutil(nom, q.locale);
    if (etiquette) emettre({ type: "outil", etiquette, etat });
  };

  const ctx: ContexteDesOutils = {
    api,
    tenantId: q.tenantId,
    locale: q.locale,
    organisation: dossier.organisation,
    aujourdhui,
    conseil: deps.conseil,
    idProposition: deps.idProposition ?? (() => crypto.randomUUID()),
    repondreSansTexte: configuration.sansTexte === "marquer",
    // Un calcul n'emploie que ce que la personne a écrit ou qu'un outil a rendu.
    nombresAdmis: () =>
      new Set([
        ...chiffresDe(q.question),
        ...garde.toutesLesSources().flatMap((s) => chiffresDe(`${s.titre}\n${s.texte}`)),
      ]),
    // Le périmètre élargi : seulement si la personne le regarde, et sur SES sociétés.
    ...(q.toutesLesSocietes && (dossier.societes?.length ?? 0) > 1
      ? { societes: dossier.societes! }
      : {}),
  };

  /* ------------------------------------------------------------ la requête */
  // L'outil final vient en dernier : c'est lui qui porte le point de cache.
  const definitions = [
    ...DEFINITIONS,
    // Offert seulement quand il y a de quoi comparer : le modèle ne le voit pas autrement.
    ...(ctx.societes ? [COMPARER_LES_SOCIETES] : []),
    AFFICHER_VISUEL,
    CONCLURE_REPONSE,
  ];
  const outils = definitions.map((d, i) =>
    i === definitions.length - 1 ? { ...d, cache_control: { type: "ephemeral" as const } } : d,
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
  // Les visuels que les outils ont composés (par clé de source), et ceux que le
  // modèle a choisi de montrer — dans l'ordre, une fois chacun.
  const visuels = new Map<string, BlocDeReponse>();
  const blocs: BlocDeReponse[] = [];
  const montres = new Set<string>();
  const mentions: string[] = [];
  let conclusion: ConclusionDeLaReponse | null = null;
  let usageTotal: UsageDeLAppel = { ...USAGE_NUL };
  let coutTotal: number | null = 0;
  let modeleRendu: string = choix.modele;
  let iterations = 0;
  let interrompue: string | null = null;
  // Le dernier tour du modèle, s'il a fini sans appeler d'outil : ce qu'on lui
  // remet quand il faut lui demander sa conclusion.
  let dernierTour: Parameters<typeof tourARenvoyer>[0] | null = null;
  // Les annonces d'outil que l'écran n'a pas vues (mesure).
  let annoncesTues = 0;

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
    // Par tour : une conclusion écrite en clair coupe la suite du tour, pas la réponse suivante.
    const filtre = new FiltreDeMecanique();
    const debutAppel = maintenant();
    garde.nouveauTour();
    /*
     * L'ANNONCE D'UN OUTIL NE PART PAS À L'ÉCRAN. Avant de lire, le modèle écrit
     * souvent une phrase pour lui-même (« Je regarde d'abord ce que disent les
     * textes », parfois en anglais, parfois « ce message vient de l'interface »
     * — relevé à l'écran sur staging le 11 novembre 2026). L'écran dit déjà
     * l'étape en cours, dans la langue de la personne. Tant qu'aucun outil
     * n'a encore rien rendu, le premier paragraphe d'un tour attend donc de
     * savoir ce qui le suit : une lecture, et il tombe ; un second paragraphe,
     * un visuel, une conclusion ou la fin du tour, et il part tel quel, jugé
     * par la garde comme le reste. Une réponse n'y perd que l'attente de son
     * premier paragraphe. Dès qu'un outil a répondu, plus rien n'attend : ce
     * que Malica écrit alors peut être un début de réponse, et le perdre
     * serait pire que de laisser passer une annonce.
     */
    let preambule: { texte: string; citations: CitationRecue[]; close: boolean } | null =
      outilsAppeles.length === 0 ? { texte: "", citations: [], close: false } : null;
    const liberer = (): void => {
      if (!preambule) return;
      const tenue = preambule;
      preambule = null;
      garde.ouvrirBloc();
      for (const c of tenue.citations) garde.recevoirCitation(c);
      envoyerTexte(garde.recevoirTexte(tenue.texte));
      if (tenue.close) fermer();
    };
    const fermer = (): void => {
      const j = garde.fermerBloc();
      envoyerTexte(j.aEmettre);
      // Le nombre seulement : la phrase retirée porte le chiffre sans source.
      if (!enAttente && j.retirees.length > 0)
        emettre({ type: "retire", nombre: j.retirees.length });
    };
    const texteDuModele = (t: string): void => {
      if (!preambule) {
        envoyerTexte(garde.recevoirTexte(t));
        return;
      }
      preambule.texte += t;
      // Un second paragraphe commence : ce n'était pas une annonce.
      if (SECOND_PARAGRAPHE.test(preambule.texte)) liberer();
    };
    try {
      for await (const ev of client(requete)) {
        assembleur.recevoir(ev);
        const i = ev.index;
        if (ev.type === "content_block_start" && typeof i === "number") {
          if (ev.content_block?.type === "text") {
            blocsDeTexte.add(i);
            // Un second bloc de texte : le premier n'annonçait pas un outil.
            if (preambule?.close) liberer();
            if (!preambule) garde.ouvrirBloc();
          } else if (ev.content_block?.type === "tool_use") {
            const nom = String((ev.content_block as { name?: string }).name);
            if (preambule && !SUITES_D_UNE_REPONSE.has(nom)) {
              if (preambule.texte.trim()) annoncesTues += 1;
              preambule = null;
            } else liberer();
            etape(nom, "debut");
          }
        } else if (
          ev.type === "content_block_delta" &&
          typeof i === "number" &&
          blocsDeTexte.has(i)
        ) {
          if (ev.delta?.type === "text_delta") {
            texteDuModele(filtre.passer(ev.delta.text ?? ""));
          } else if (ev.delta?.type === "citations_delta" && ev.delta.citation) {
            if (preambule) preambule.citations.push(ev.delta.citation);
            else garde.recevoirCitation(ev.delta.citation);
          }
        } else if (
          ev.type === "content_block_stop" &&
          typeof i === "number" &&
          blocsDeTexte.has(i)
        ) {
          texteDuModele(filtre.vider());
          if (preambule) preambule.close = true;
          else fermer();
        }
      }
      // Le tour finit sans lecture : ce qui attendait était la réponse.
      liberer();
    } catch (e) {
      const m = assembleur.message();
      await journaliser(api, {
        tenantId: q.tenantId,
        modele: choix.modele,
        usage: m.usage,
        latencyMs: maintenant() - debutAppel,
        erreur: e instanceof Error ? e.message : String(e),
      });
      if (
        fournisseur === "claude" &&
        tour === 0 &&
        !texteMontre &&
        (repliPossible || deepseekEnBoucle)
      )
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

    if (m.stopReason !== "tool_use") {
      // Seulement un tour fini proprement et qui ne porte que du texte : un
      // tour coupé au milieu d'un outil ne se renvoie pas au modèle.
      const renvoi = tourARenvoyer(m.content);
      const propre =
        m.stopReason === "end_turn" && renvoi.length > 0 && renvoi.every((b) => b.type === "text");
      dernierTour = propre ? m.content : null;
      break;
    }

    const appels = m.content.filter((b) => b.type === "tool_use") as Array<{
      id: string;
      name: string;
      input: unknown;
    }>;
    const resultats: unknown[] = [];
    const annonces: string[] = [];
    let conclusionIllisible = false;
    for (const appel of appels) {
      if (appel.name === CONCLURE_REPONSE.name) {
        const lue = lireLaConclusion(appel.input);
        if (lue) conclusion = lue;
        else conclusionIllisible = true;
        resultats.push({
          type: "tool_result",
          tool_use_id: appel.id,
          ...(lue
            ? { content: "Conclusion enregistrée." }
            : {
                content:
                  "Conclusion illisible : rappelle conclure_reponse avec exactement les champs demandés.",
                is_error: true,
              }),
        });
        continue;
      }
      if (appel.name === AFFICHER_VISUEL.name) {
        const cle = (appel.input as { source?: unknown } | null)?.source;
        const bloc = typeof cle === "string" ? visuels.get(cle) : undefined;
        if (bloc && typeof cle === "string") {
          if (!montres.has(cle)) {
            montres.add(cle);
            // Là où Malica en est de sa réponse : l'écran pose le bloc à cet endroit.
            const place = { ...bloc, apres: garde.texteEmis().length };
            blocs.push(place);
            // En attente de la conclusion, le bloc attend aussi : une réponse
            // retenue ne montre que son message de relecture.
            if (!enAttente) emettre({ type: "bloc", bloc: place });
          }
          resultats.push({
            type: "tool_result",
            tool_use_id: appel.id,
            content:
              "Visuel affiché. N'en parle pas : ne dis ni qu'il est affiché, ni où, ni ce qu'il montre. Ne recopie pas ses lignes : dis ce que ses chiffres veulent dire pour la personne.",
          });
        } else {
          resultats.push({
            type: "tool_result",
            tool_use_id: appel.id,
            content:
              visuels.size > 0
                ? `Aucun visuel pour cette source. Visuels disponibles : ${[...visuels.keys()].join(", ")}.`
                : "Aucun visuel n'est disponible : réponds en texte.",
            is_error: true,
          });
        }
        continue;
      }
      outilsAppeles.push(appel.name);
      const r = await executerOutil(ctx, appel.name, appel.input);
      etape(appel.name, "fin");
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
      // Le corpus, consulté, n'a pas répondu : Malica répond quand même, et ce
      // qu'elle chiffre de mémoire part marqué (M-9, choix du dirigeant).
      if (
        configuration.sansTexte === "marquer" &&
        r.sources.some((s) => s.cle.startsWith("malica:conseil:refus:"))
      ) {
        garde.marquerSansSource(
          message(q.locale, "pme.assistant.nonVerifie"),
          configuration.unitesMarquables,
        );
      }
      for (const v of r.visuels ?? []) visuels.set(v.cle, v.bloc);
      resultats.push({
        type: "tool_result",
        tool_use_id: appel.id,
        content: r.sources.map(blocDeRecherche),
      });
      // Dit À CÔTÉ du résultat, jamais dedans : l'API refuse un résultat d'outil
      // qui mêle des blocs de recherche à autre chose (essai réel du 10 novembre
      // 2026 : « if any blocks in a tool result are of type search_result, all
      // blocks must be of that type » — toute réponse à outil était interrompue).
      for (const v of r.visuels ?? [])
        annonces.push(
          `Un visuel est disponible pour la source « ${v.cle} » : afficher_visuel le montre à la personne.`,
        );
      for (const p of r.propositions ?? []) {
        propositions.push(p);
        // En attente de la conclusion, le bouton attend aussi : une réponse
        // retenue ne montre rien d'autre que son message de relecture.
        if (!enAttente) emettre({ type: "proposition", proposition: p });
      }
      if (r.mention) mentions.push(r.mention);
      if (r.coutUsd !== undefined) {
        coutTotal = coutTotal === null || r.coutUsd === null ? null : coutTotal + r.coutUsd;
      }
    }
    // La conclusion seule, et lisible : la réponse est finie, rien à renvoyer.
    if (appels.every((a) => a.name === CONCLURE_REPONSE.name) && !conclusionIllisible) break;
    messages.push({ role: "assistant", content: tourARenvoyer(m.content) });
    messages.push({
      role: "user",
      // Les résultats d'outils d'abord, comme l'API l'exige ; les annonces ensuite.
      content: [...resultats, ...annonces.map((text) => ({ type: "text" as const, text }))],
    });
  }

  /*
   * LA CONCLUSION DEMANDÉE. Mesuré le 11 novembre 2026 sur le vrai modèle : cinq
   * réponses générales sur huit finissaient sans `conclure_reponse`. Leur portée
   * restait « incertaine », et sous mandat une explication de l'inflation
   * partait en relecture chez le comptable. Quand un cabinet peut relire et que
   * le modèle n'a pas conclu, on la lui demande une fois, outil imposé. S'il ne
   * la rend pas, la portée reste incertaine : le défaut prudent ne bouge pas.
   */
  if (
    conclusion === null &&
    dernierTour !== null &&
    !interrompue &&
    garde.texteEmis() !== "" &&
    doitEtreRelue(SANS_CONCLUSION, contexte)
  ) {
    const assembleur = new Assembleur();
    const debutAppel = maintenant();
    try {
      for await (const ev of client({
        model: choix.modele,
        max_tokens: reglage.sortie_max_jetons,
        output_config: { effort: choix.effort },
        thinking: { type: "disabled" },
        cache_control: { type: "ephemeral" },
        tools: outils,
        tool_choice: { type: "tool", name: CONCLURE_REPONSE.name },
        system,
        messages: [
          ...messages,
          { role: "assistant", content: tourARenvoyer(dernierTour) },
          { role: "user", content: [{ type: "text", text: DEMANDE_DE_CONCLUSION }] },
        ],
      })) {
        assembleur.recevoir(ev);
      }
      const m = assembleur.message();
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
      const appel = m.content.find(
        (b) => b.type === "tool_use" && (b as { name?: string }).name === CONCLURE_REPONSE.name,
      ) as { input: unknown } | undefined;
      const lue = appel ? lireLaConclusion(appel.input) : null;
      if (lue) conclusion = lue;
    } catch (e) {
      // La demande a échoué : la portée reste incertaine, et la réponse est
      // relue. L'échec se journalise — un appel payant ne disparaît pas.
      await journaliser(api, {
        tenantId: q.tenantId,
        modele: choix.modele,
        usage: assembleur.message().usage,
        latencyMs: maintenant() - debutAppel,
        erreur: e instanceof Error ? e.message : String(e),
      }).catch(() => undefined);
    }
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
  const reponseGardee = [dite, ...ajouts].filter(Boolean).join("\n\n");

  /*
   * La relecture. La règle est celle d'`askMalica`, appliquée à ce que le
   * modèle a conclu (ou à la portée incertaine, s'il n'a pas conclu). Une
   * réponse vide n'a rien à faire relire.
   */
  // Un chiffre « non vérifié » part chez le comptable quelle que soit la portée
  // que le modèle a conclue : c'est la raison même de la marque.
  const nonVerifie = garde.marquees().length > 0;
  const cabinetPeutRelire = contexte?.appelantMembre === true && contexte.cabinetId !== null;
  const aRelire =
    dite !== "" &&
    (doitEtreRelue(conclusion ?? SANS_CONCLUSION, contexte) || (nonVerifie && cabinetPeutRelire));
  const retenue = enAttente && aRelire;
  const sourcesCitees = garde.sourcesCitees();
  const deposerAuCabinet = async (): Promise<void> => {
    const c = conclusion ?? SANS_CONCLUSION;
    const articles = articlesCites(sourcesCitees);
    await api.rpc<{ id: string; cabinetId: string }>("conseil", "creer", [
      {
        tenantId: q.tenantId,
        conversationId,
        question: q.question,
        reponse: reponseGardee,
        sources: articles,
        // Comme `lireReponseDeConseil` : sans article cité, un avis vaut zéro.
        // Un chiffre « non vérifié » est la raison même de l'envoi : la réponse
        // n'arrive jamais au cabinet comme certaine, et le doute le lui dit.
        certitude: nonVerifie
          ? 0
          : !c.conseil
            ? 1
            : articles.length === 0
              ? 0
              : Math.round(c.certitude * 100) / 100,
        doute: nonVerifie
          ? [c.conseil ? c.doute : null, message(q.locale, "pme.conseil.douteNonVerifie")]
              .filter(Boolean)
              .join(" ")
          : c.conseil
            ? c.doute
            : null,
        canal: "conversation",
        theme: c.conseil ? c.theme : null,
        langue: q.locale,
        statut: "en_attente",
      },
    ]);
  };
  /*
   * « ANNONCER » (décision du dirigeant, 11 novembre 2026) : la réponse est
   * déjà partie, entière. Elle entre dans la file du cabinet, et Malica le dit.
   * Si la file la refuse, la réponse reste — mais Malica n'annonce pas un envoi
   * qui n'a pas eu lieu : elle dit de la faire confirmer.
   */
  let annonce: string | null = null;
  if (nonVerifie && !retenue) ajouts.push(message(q.locale, "pme.assistant.nonVerifieNote"));
  if (aRelire && !retenue) {
    annonce = await deposerAuCabinet().then(
      () => message(q.locale, "pme.conseil.aConfirmer"),
      () => message(q.locale, "pme.conseil.aConfirmerSansEnvoi"),
    );
  } else if (
    /*
     * SANS COMPTABILITÉ RELIÉE AU DOSSIER, la comptabilité de la société reste
     * l'expert (décision du dirigeant, 11 novembre 2026). Malica n'a personne à
     * qui envoyer sa réponse dans l'application : elle dit de la faire
     * confirmer, et pourquoi elle ne l'envoie pas. Seulement pour un avis que
     * le modèle a lui-même conclu engageant : sans conclusion, une explication
     * générale ne s'annonce pas ; et un chiffre non vérifié porte déjà sa note,
     * qui dit la même chose.
     */
    dite !== "" &&
    !nonVerifie &&
    contexte?.appelantMembre === true &&
    contexte.cabinetId === null &&
    conclusion !== null &&
    conclusion.conseil &&
    conclusion.portee !== "generale"
  ) {
    annonce = message(q.locale, "pme.conseil.aConfirmerSansComptabilite");
  }
  let reponse: string;
  if (retenue) {
    // Une réponse retenue qui ne pourrait pas entrer dans la file serait
    // perdue : cet échec-là remonte, comme dans `askMalica`.
    await deposerAuCabinet();
    reponse = message(q.locale, "pme.conseil.relecture");
    montrer(reponse);
  } else {
    if (annonce) ajouts.push(annonce);
    reponse = [dite, ...ajouts].filter(Boolean).join("\n\n");
    if (enAttente) {
      // La conclusion est connue et la réponse peut partir : d'un bloc.
      montrer(reponse);
      for (const b of blocs) emettre({ type: "bloc", bloc: b });
      for (const p of propositions) emettre({ type: "proposition", proposition: p });
      if (garde.retirees().length > 0) emettre({ type: "retire", nombre: garde.retirees().length });
    } else {
      for (const [k, a] of ajouts.entries()) montrer(dite || k > 0 ? `\n\n${a}` : a);
    }
  }

  const latenceTotale = maintenant() - debut;
  const sourcesAffichees = retenue
    ? []
    : sourcesCitees.filter((s) => !s.cle.startsWith("malica:proposition:")).map(versSourceAffichee);
  const propositionsAffichees = retenue ? [] : propositions;
  const blocsAffiches = retenue ? [] : blocs;
  await api.rpc<void>("conversations", "ajouter", [
    {
      conversationId,
      question: q.question,
      // Retenue, le fil garde le message de relecture — ce que la PME a lu.
      reponse,
      model: modeleRendu,
      tokensIn: usageTotal.entree + usageTotal.cacheLu + usageTotal.cacheEcrit,
      tokensOut: usageTotal.sortie,
      latencyMs: latenceTotale,
      // Rangées avec la réponse : un fil rouvert réaffiche ses sources et ses
      // propositions (le bouton se rejuge alors contre la porte du circuit).
      sources: sourcesAffichees,
      propositions: propositionsAffichees,
      blocs: blocsAffiches,
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

  const fin: FinMesuree = {
    conversationId,
    messageId: dernierMessage?.id ?? null,
    titre,
    reponse,
    sources: sourcesAffichees,
    propositions: propositionsAffichees,
    suggestions: retenue ? [] : suggestionsDeSuite(outilsAppeles, q.locale),
    blocs: blocsAffiches,
    chiffresRetires: retenue ? 0 : garde.retirees().length,
    sansCitations: false,
    mesure: {
      modele: modeleRendu,
      repli: fournisseur === "deepseek" ? "deepseek" : null,
      motifDuRepli: fournisseur === "deepseek" ? motif : null,
      latencePremierMotMs: premierMot,
      latenceTotaleMs: latenceTotale,
      coutUsd: coutTotal === null ? null : Math.round(coutTotal * 1_000_000) / 1_000_000,
      outils: outilsAppeles,
      iterations,
      conclusion,
      retenue,
      annoncee: annonce !== null,
      nonVerifies: garde.marquees().length,
      annoncesTues,
    },
  };
  emettre({ type: "fin", fin: versLEcran(fin) });
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
): Promise<FinMesuree> {
  try {
    return await converser(api, dossier, q, deps, emettre);
  } catch (e) {
    if (!(e instanceof PanneAvantLePremierMot)) throw e;
    // DeepSeek reprend la question DANS LA BOUCLE quand son client est branché :
    // mêmes outils et même garde, sur le fil déjà ouvert.
    if (deps.deepseek) {
      return await converser(
        api,
        dossier,
        { ...q, conversationId: e.conversationId },
        deps,
        emettre,
        true,
      );
    }
    const maintenant = deps.maintenant ?? (() => Date.now());
    return repondreParLeRepli(
      { ...q, conversationId: e.conversationId },
      deps,
      emettre,
      maintenant(),
      maintenant,
      "panne",
    );
  }
}

async function repondreParLeRepli(
  q: QuestionPosee,
  deps: DependancesDeLAssistant,
  emettre: (ev: EvenementDeLAssistant) => void,
  debut: number,
  maintenant: () => number,
  motif: MotifDuRepli,
): Promise<FinMesuree> {
  // Le repli ne cite pas en flux : sa réponse entière passe la même garde,
  // contre ce qu'il avait sous les yeux — et AVANT d'être rangée au fil.
  const garde = new GardeDesChiffres(q.question);
  let controlee: string | null = null;
  const garder = (brute: string, sources: SourceConnue[]): string => {
    for (const s of sources) garde.ajouterSource(s);
    garde.jugerTout(brute);
    controlee = garde.texteEmis() || message(q.locale, "pme.assistant.vide");
    return controlee;
  };
  // `askMalica` applique lui-même la relecture du cabinet : retenue, sa réponse
  // EST le message de relecture, et la file a déjà reçu la réponse. Rien n'est
  // déposé une seconde fois ici.
  const r = await deps.repli({ question: q.question, conversationId: q.conversationId, garder });
  emettre({ type: "debut", conversationId: r.conversationId });
  // Un repli qui n'aurait pas appelé `garder` ne montre rien d'incontrôlé :
  // sa réponse passe la garde ici, sans aucune source — toute phrase chiffrée
  // tombe.
  const reponse = controlee ?? garder(r.answer, []);
  const premierMot = maintenant() - debut;
  emettre({ type: "texte", texte: reponse });
  if (garde.retirees().length > 0) emettre({ type: "retire", nombre: garde.retirees().length });
  const retenue = r.retenue === true;
  const fin: FinMesuree = {
    conversationId: r.conversationId,
    messageId: r.messageId,
    titre: r.titre,
    reponse,
    sources: [],
    propositions: [],
    suggestions: retenue ? [] : suggestionsDeSuite([], q.locale),
    blocs: [],
    chiffresRetires: garde.retirees().length,
    sansCitations: !retenue,
    mesure: {
      modele: r.model,
      repli: "deepseek",
      motifDuRepli: motif,
      latencePremierMotMs: premierMot,
      latenceTotaleMs: maintenant() - debut,
      coutUsd: null,
      outils: [],
      iterations: 1,
      conclusion: null,
      retenue,
      annoncee: false,
      nonVerifies: 0,
      annoncesTues: 0,
    },
  };
  emettre({ type: "fin", fin: versLEcran(fin) });
  return fin;
}

/** Les deux budgets épuisés : aucun appel, un message honnête, le fil garde l'échange. */
async function sArreter(
  api: AppelApi,
  q: QuestionPosee,
  emettre: (ev: EvenementDeLAssistant) => void,
  debut: number,
  maintenant: () => number,
  motif: MotifDuRepli,
): Promise<FinMesuree> {
  const conversationId =
    q.conversationId ??
    (await api.rpc<{ id: string }>("conversations", "ouvrirNouvelle", [q.tenantId])).id;
  emettre({ type: "debut", conversationId });
  const reponse = message(q.locale, "pme.assistant.arret");
  emettre({ type: "texte", texte: reponse });
  await api.rpc<void>("conversations", "ajouter", [
    { conversationId, question: q.question, reponse, model: null, latencyMs: 0 },
  ]);
  const fin: FinMesuree = {
    conversationId,
    messageId: null,
    titre: null,
    reponse,
    sources: [],
    propositions: [],
    suggestions: [],
    blocs: [],
    chiffresRetires: 0,
    sansCitations: false,
    mesure: {
      modele: null,
      repli: "arret",
      motifDuRepli: motif,
      latencePremierMotMs: maintenant() - debut,
      latenceTotaleMs: maintenant() - debut,
      coutUsd: 0,
      outils: [],
      iterations: 0,
      conclusion: null,
      retenue: false,
      annoncee: false,
      nonVerifies: 0,
      annoncesTues: 0,
    },
  };
  emettre({ type: "fin", fin: versLEcran(fin) });
  return fin;
}
