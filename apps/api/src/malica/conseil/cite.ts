/**
 * Le conseil CITÉ — ce que Claude reçoit, et ce qu'on lit dans ce qu'il rend.
 *
 * ================================================================ LE PRINCIPE
 *
 * Claude ne connaît pas fiablement le droit fiscal tunisien à jour. On ne lui
 * demande donc pas de s'en souvenir : on lui remet les passages du corpus
 * comme RÉSULTATS DE RECHERCHE CITABLES (blocs `search_result` de l'API
 * Messages, citations activées), et chaque phrase de sa réponse revient
 * accrochée au bloc qui la fonde (`search_result_location`).
 *
 * Ce module est PUR : il construit la requête, choisit le modèle, relit la
 * réponse et chiffre son coût. Aucun réseau, aucune base — tout ce qu'il sait
 * lui est passé, et `cite.test.ts` l'éprouve branche par branche.
 *
 * ========================================= CE QUE CE MODULE NE CROIT PAS
 *
 * Une citation. Une citation est relue dans la liste des résultats qu'on a
 * envoyés : son index ET sa source doivent y correspondre, sinon elle tombe.
 * C'est la règle de R2 transposée au droit : on relit dans ce qu'on a montré,
 * jamais dans ce que le modèle affirme avoir lu.
 *
 * Et une réponse sans aucune citation valide n'est pas une réponse : c'est un
 * REFUS, quoi que dise son texte. C'est la base de la mesure « refus
 * corrects » de l'épreuve, et la garantie qu'aucune règle énoncée de mémoire
 * ne passe pour du droit.
 *
 * =============================================== POURQUOI PAS DE SORTIE JSON
 *
 * Les citations et les sorties structurées (`output_config.format`) sont
 * incompatibles : l'API rend 400 si les deux sont demandées (documentation
 * « Structured outputs », section Citations, relevée le 8 novembre 2026).
 * La réponse est donc du texte cité, et la structure — sources, versions,
 * refus — se DÉDUIT des citations, ce qui vaut mieux qu'un objet déclaré.
 */

import type { PassageTrouve } from "../../depots/corpus.ts";
import type { ParametreFiscal } from "./corpus.ts";

/* ------------------------------------------------------------ la configuration -- */

/** Le réglage du conseil cité, tel que `public.conseil_cite_configuration()` le rend. */
export interface ReglageDuConseil {
  modele_courant: string;
  modele_difficile: string;
  longueur_difficile: number;
  mots_difficiles: string[];
  corpus_distincts_difficile: number;
  passages_max: number;
  distance_max: number;
  distance_max_mots: number;
  sortie_max_jetons: number;
}

export interface TarifDeModele {
  model: string;
  role: string;
  in: number;
  out: number;
}

interface SourceHierarchique {
  code: string;
  libelle: string;
  autorite: string;
  opposable_a: string;
  fondement: string | null;
}

export interface ConfigurationCitee {
  consigne: { id: string; texte: string; decide_le: string };
  reglage: ReglageDuConseil;
  tarifs: TarifDeModele[];
  sources: SourceHierarchique[];
}

/**
 * La configuration lue en base, vérifiée. Une configuration incomplète est
 * une panne qui se dit — pas un repli sur une consigne écrite ici (R4, R10).
 */
export function lireConfiguration(brut: unknown): ConfigurationCitee {
  const c = brut as Partial<ConfigurationCitee> | null;
  if (!c?.consigne?.texte?.trim()) throw new Error("conseil.cite.consigne_absente");
  const r = c.reglage;
  if (!r?.modele_courant || !r.modele_difficile) throw new Error("conseil.cite.reglage_absent");
  return {
    consigne: c.consigne,
    reglage: {
      ...r,
      mots_difficiles: Array.isArray(r.mots_difficiles) ? r.mots_difficiles : [],
      distance_max: Number(r.distance_max),
      distance_max_mots: Number(r.distance_max_mots),
    },
    tarifs: (c.tarifs ?? []).map((t) => ({ ...t, in: Number(t.in), out: Number(t.out) })),
    sources: c.sources ?? [],
  };
}

/* ------------------------------------------------------------ les mots -- */

/**
 * Les mots d'une question qui portent son sujet, pour l'index lexical.
 *
 * Toutes écritures confondues (`\p{L}`) : une question en arabe garde ses
 * mots — la fonction voisine de `corpus.ts`, faite pour le paramétrage, ne
 * garde que l'alphabet latin. Les nombres restent : « article 52 », « 51 ter ».
 */
export function motsDeRecherche(question: string): string[] {
  const OUTILS = new Set([
    // français
    "quel",
    "quelle",
    "quels",
    "quelles",
    "pour",
    "dans",
    "avec",
    "sans",
    "mon",
    "mes",
    "votre",
    "vos",
    "notre",
    "nos",
    "cette",
    "cet",
    "ces",
    "est",
    "sont",
    "etre",
    "avoir",
    "combien",
    "comment",
    "pourquoi",
    "quand",
    "faut",
    "dois",
    "doit",
    "peut",
    "puis",
    "plus",
    "moins",
    "une",
    "des",
    "les",
    "par",
    "sur",
    "que",
    "qui",
    "quoi",
    "aux",
    "entre",
    "selon",
    "applicable",
    "applique",
    "tunisie",
    "tunisien",
    "tunisienne",
    // anglais
    "what",
    "which",
    "the",
    "for",
    "and",
    "with",
    "how",
    "does",
    "tunisia",
    // arabe
    "ما",
    "ماذا",
    "هل",
    "في",
    "على",
    "من",
    "إلى",
    "عن",
    "كيف",
    "متى",
    "هي",
    "هو",
  ]);
  const vus = new Set<string>();
  const mots: string[] = [];
  for (const brut of question.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const sansAccent = brut.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const garde = /^\p{N}+$/u.test(brut) || brut.length >= 3;
    if (!garde || OUTILS.has(brut) || OUTILS.has(sansAccent)) continue;
    if (vus.has(brut)) continue;
    vus.add(brut);
    mots.push(brut);
  }
  return mots.slice(0, 16);
}

/* ------------------------------------------------------------ le modèle -- */

/**
 * Haiku par défaut ; Sonnet si la question est jugée difficile.
 *
 * La règle est simple, lisible et réglée en base (R10) : une question est
 * difficile si elle est longue, OU si elle contient l'un des mots désignés,
 * OU si les passages retenus viennent de plusieurs textes distincts — le
 * signe qu'il faudra articuler un code, une loi de finances et une note.
 */
export function choisirLeModele(
  question: string,
  corpusDistincts: number,
  reglage: Pick<
    ReglageDuConseil,
    | "modele_courant"
    | "modele_difficile"
    | "longueur_difficile"
    | "mots_difficiles"
    | "corpus_distincts_difficile"
  >,
): { modele: string; difficile: boolean; motif: string | null } {
  const q = question.toLowerCase();
  if (q.trim().length > reglage.longueur_difficile) {
    return { modele: reglage.modele_difficile, difficile: true, motif: "longueur" };
  }
  const mot = reglage.mots_difficiles.find((m) => m.trim() && q.includes(m.toLowerCase()));
  if (mot) return { modele: reglage.modele_difficile, difficile: true, motif: `mot:${mot}` };
  if (corpusDistincts >= reglage.corpus_distincts_difficile) {
    return { modele: reglage.modele_difficile, difficile: true, motif: "textes_multiples" };
  }
  return { modele: reglage.modele_courant, difficile: false, motif: null };
}

/* ------------------------------------------------------------ les résultats -- */

/** Ce qu'un résultat de recherche désigne, pour relire une citation. */
export type ResultatCitable =
  | {
      type: "article";
      source: string;
      corpus: string;
      numero: string;
      validFrom: string | null;
      validTo: string | null;
      langue: string;
    }
  | {
      type: "parametre";
      source: string;
      code: string;
      corpus: string;
      article: string | null;
      validFrom: string | null;
      validTo: string | null;
    };

/** Un bloc `search_result` de l'API Messages. */
export interface BlocDeRecherche {
  type: "search_result";
  source: string;
  title: string;
  content: Array<{ type: "text"; text: string }>;
  citations: { enabled: true };
}

/** La source stable d'un passage : le texte, l'article ET sa version. */
export function sourceDuPassage(p: Pick<PassageTrouve, "corpus" | "numero" | "validFrom">): string {
  return `malica://corpus/${encodeURIComponent(p.corpus)}/${encodeURIComponent(p.numero)}@${p.validFrom ?? "?"}`;
}

function sourceDuParametre(p: Pick<ParametreFiscal, "code" | "validFrom">): string {
  return `malica://referentiel/${encodeURIComponent(p.code)}@${p.validFrom ?? "?"}`;
}

/**
 * Le texte d'un passage, coupé en blocs.
 *
 * Claude cite des BLOCS entiers, pas des sous-chaînes : un fragment de 1 800
 * caractères rendu d'un bloc ferait citer tout l'article pour une phrase.
 * On coupe aux fins de phrase, en blocs de quelques centaines de caractères.
 */
export function decouperEnBlocs(texte: string, longueurMax = 450): string[] {
  const propre = texte
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  if (!propre) return [];
  const phrases = propre.split(/(?<=[.;:!?\u061f])\s+|\n+/u).filter((p) => p.trim());
  const blocs: string[] = [];
  let courant = "";
  for (const phrase of phrases) {
    const p = phrase.trim();
    if (courant && courant.length + 1 + p.length > longueurMax) {
      blocs.push(courant);
      courant = "";
    }
    if (p.length > longueurMax) {
      // Une phrase démesurée (un tableau aplati) : on la tranche aux espaces.
      let reste = p;
      while (reste.length > longueurMax) {
        const coupe = reste.lastIndexOf(" ", longueurMax);
        const at = coupe > longueurMax / 2 ? coupe : longueurMax;
        blocs.push(reste.slice(0, at).trim());
        reste = reste.slice(at).trim();
      }
      courant = reste;
      continue;
    }
    courant = courant ? `${courant} ${p}` : p;
  }
  if (courant) blocs.push(courant);
  return blocs;
}

function validite(validFrom: string | null, validTo: string | null): string {
  return validTo
    ? `en vigueur du ${validFrom ?? "?"} au ${validTo} (exclu)`
    : `en vigueur depuis le ${validFrom ?? "?"}`;
}

/**
 * Les passages et les paramètres, en résultats de recherche citables.
 *
 * Le TITRE porte ce qui permet de peser le texte — article, version, nature,
 * portée, statut — pour que Claude ne cite pas une note commune comme la loi.
 */
export function resultatsCitables(
  passages: readonly PassageTrouve[],
  parametres: readonly ParametreFiscal[],
  noms: Readonly<Record<string, string>> = {},
): { blocs: BlocDeRecherche[]; index: ResultatCitable[] } {
  const blocs: BlocDeRecherche[] = [];
  const index: ResultatCitable[] = [];

  for (const p of passages) {
    const contenu = decouperEnBlocs(p.texte);
    if (contenu.length === 0) continue;
    const nom = noms[p.corpus] ?? p.corpus;
    const statut = p.statut && p.statut !== "en_vigueur" ? ` — STATUT : ${p.statut}` : "";
    const abroge = p.abrogePar ? ` (abrogé par ${p.abrogePar})` : "";
    const nature = p.nature ?? "nature non déterminée";
    const portee = p.opposableA ? `opposable à : ${p.opposableA}` : "portée non déterminée";
    const lecture = p.provenance === "verbatim" ? "" : ` — lecture : ${p.provenance}`;
    const jort = p.jortReference ? ` — ${p.jortReference}` : "";
    const source = sourceDuPassage(p);
    blocs.push({
      type: "search_result",
      source,
      title:
        `${nom} (${p.corpus}), art. ${p.numero} — version ${validite(p.validFrom, p.validTo)} — ` +
        `${nature}, ${portee}${statut}${abroge}${jort}${lecture} — texte en ${p.langue}`,
      content: contenu.map((text) => ({ type: "text" as const, text })),
      citations: { enabled: true },
    });
    index.push({
      type: "article",
      source,
      corpus: p.corpus,
      numero: p.numero,
      validFrom: p.validFrom,
      validTo: p.validTo,
      langue: p.langue,
    });
  }

  for (const p of parametres) {
    const fondement = p.article ? `${p.corpus} ${p.article}` : p.corpus;
    const reserve = p.confiance === "confirme" ? "" : ` — VALEUR ${p.confiance.toUpperCase()}`;
    const source = sourceDuParametre(p);
    const lignes = [
      `${p.libelle} : ${p.valeur} (${p.forme}, ${p.echelle}).`,
      `Fondement : ${fondement}, ${p.autorite}, ${validite(p.validFrom, p.validTo)}${reserve}.`,
      ...(p.citation ? [`Texte : ${p.citation}`] : []),
      ...(p.note ? [`Note : ${p.note}`] : []),
    ];
    blocs.push({
      type: "search_result",
      source,
      title: `Paramètre du référentiel ${p.code} — ${p.libelle} — ${validite(p.validFrom, p.validTo)}`,
      content: lignes.map((text) => ({ type: "text" as const, text })),
      citations: { enabled: true },
    });
    index.push({
      type: "parametre",
      source,
      code: p.code,
      corpus: p.corpus,
      article: p.article,
      validFrom: p.validFrom,
      validTo: p.validTo,
    });
  }

  return { blocs, index };
}

/* ------------------------------------------------------------ la requête -- */

/** Le texte de référence stable qui suit la consigne : la hiérarchie des sources. */
function texteDeReference(sources: readonly SourceHierarchique[]): string {
  if (sources.length === 0) return "";
  return [
    "HIÉRARCHIE DES SOURCES DU DROIT FISCAL TUNISIEN (référentiel de la base)",
    ...sources.map(
      (s) =>
        `- ${s.libelle} (${s.code}) : autorité ${s.autorite} ; opposable à : ${s.opposable_a || "personne"}` +
        (s.fondement ? ` ; fondement : ${s.fondement}` : ""),
    ),
  ].join("\n");
}

const LANGUES: Record<string, string> = { fr: "français", en: "anglais", ar: "arabe" };

export interface RequeteClaude {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: Array<{
    role: "user";
    content: Array<BlocDeRecherche | { type: "text"; text: string }>;
  }>;
}

/**
 * La requête à l'API Messages.
 *
 * ================================================================ LE CACHE
 *
 * Le système — la consigne lue en base, puis la hiérarchie des sources — est
 * identique d'une question à l'autre tant que la tour ne publie pas de
 * version nouvelle. Le point de cache est posé sur son DERNIER bloc : tout ce
 * qui précède est relu au dixième du prix (Haiku) ou au vingtième (Sonnet).
 * Les passages, propres à la question, viennent après, hors cache.
 */
export function construireLaRequete(input: {
  modele: string;
  configuration: Pick<ConfigurationCitee, "consigne" | "reglage" | "sources">;
  blocs: readonly BlocDeRecherche[];
  question: string;
  jour: string;
  locale: string;
}): RequeteClaude {
  const reference = texteDeReference(input.configuration.sources);
  const system: RequeteClaude["system"] = [
    { type: "text", text: input.configuration.consigne.texte },
  ];
  if (reference) system.push({ type: "text", text: reference });
  system[system.length - 1]!.cache_control = { type: "ephemeral" };

  const langue = LANGUES[input.locale] ?? LANGUES["fr"]!;
  const consigneDuJour =
    `Date d'effet : ${input.jour}. Langue de l'interface : ${langue} — réponds dans la langue de la question.\n` +
    (input.blocs.length === 0
      ? "Aucun résultat de recherche ne t'est remis pour cette question.\n"
      : `${input.blocs.length} résultat(s) de recherche te sont remis ci-dessus.\n`) +
    `Question : ${input.question.trim()}`;

  return {
    model: input.modele,
    max_tokens: input.configuration.reglage.sortie_max_jetons,
    system,
    messages: [{ role: "user", content: [...input.blocs, { type: "text", text: consigneDuJour }] }],
  };
}

/* ------------------------------------------------------------ la réponse -- */

/** Ce que l'API rend, réduit à ce qu'on lit. */
export interface ReponseClaudeBrute {
  model: string;
  content: Array<{
    type: string;
    text?: string;
    citations?: Array<{
      type?: string;
      source?: string;
      title?: string;
      cited_text?: string;
      search_result_index?: number;
      start_block_index?: number;
      end_block_index?: number;
    }> | null;
  }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

interface CitationRelue {
  index: number;
  resultat: ResultatCitable;
  extrait: string;
}

interface Affirmation {
  texte: string;
  citations: CitationRelue[];
}

export interface SourceCiteeVersionnee {
  type: "article" | "parametre";
  corpus: string;
  numero: string | null;
  code: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface ReponseCitee {
  texte: string;
  affirmations: Affirmation[];
  /** Les textes cités, une entrée par version — dédoublonnés. */
  sources: SourceCiteeVersionnee[];
  /** Aucune citation valide : la réponse ne s'appuie sur aucun texte. */
  refus: boolean;
  /** Citations qui ne correspondaient à aucun résultat envoyé : tombées. */
  citationsRejetees: number;
  /** Phrases substantielles sans citation — la règle « chaque affirmation cite » les mesure. */
  nonCitees: string[];
  /**
   * Phrases non citées qui portent un chiffre, DANS LA RÉPONSE RENDUE. Vide
   * par construction : une telle phrase est adossée à la citation qui porte
   * ses chiffres, ou retirée. Le champ reste, pour que l'épreuve le vérifie.
   */
  chiffresNonCites: string[];
  /** Les phrases retirées parce qu'un de leurs chiffres n'est porté par aucune citation. */
  chiffresRetires: string[];
  /** Deux versions d'un même article citées ensemble — doit rester faux. */
  versionsMelangees: boolean;
  /** La réponse a été coupée par la borne de sortie. */
  tronquee: boolean;
}

/** Chiffres arabes orientaux et persans ramenés aux chiffres occidentaux. */
function chiffresOccidentaux(texte: string): string {
  return texte
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/**
 * Les nombres d'un texte, sous une forme comparable : « 5 000 », « 5.000 » et
 * « 5000 » sont le même nombre ; « 0,3 » et « 0.3 » aussi ; « 01 » vaut « 1 ».
 */
export function nombresDe(texte: string): string[] {
  const t = chiffresOccidentaux(texte).replace(/(\d)[ \u00a0\u202f](?=\d{3}\b)/g, "$1");
  const vus = new Set<string>();
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let n = m[0];
    // Séparateur de milliers : un point ou une virgule suivi d'exactement trois chiffres, répété.
    if (/^\d{1,3}([.,]\d{3})+$/.test(n) && !/^0[.,]/.test(n)) n = n.replace(/[.,]/g, "");
    n = n.replace(",", ".").replace(/^0+(?=\d)/, "");
    vus.add(n);
  }
  return [...vus];
}

/** Une phrase porte-t-elle un chiffre ? Toute phrase où figure un nombre. */
function porteUnChiffre(phrase: string): boolean {
  return nombresDe(phrase).length > 0;
}

/** Les phrases d'un bloc de texte, séparateurs compris (pour se recoller telles quelles). */
function phrasesDe(texte: string): string[] {
  // Une fin de phrase est suivie d'une majuscule, d'une lettre arabe ou d'un
  // saut de ligne ; « art. 49 » et « al. 2 » ne coupent pas.
  return texte
    .split(/(?<=(?<!\b(?:art|al|n°|cf))[.!?؟])(?=\s+(?:\p{Lu}|[\u0600-\u06ff]|\n))/u)
    .filter((p) => p.length > 0);
}

/**
 * La règle « chaque affirmation porte sa citation », appliquée aux chiffres.
 *
 * Claude cite par blocs, et le texte qui relie deux citations — la phrase
 * d'annonce, une transition — arrive sans citation. Ce texte ne peut pas
 * porter un chiffre qui n'aurait pas sa source :
 *
 *   - chaque nombre d'une phrase non citée doit se lire dans le texte cité
 *     de l'une des citations de la réponse, ou dans l'identité d'une source
 *     citée (son numéro d'article, son texte, sa version) ;
 *   - si oui, la phrase reçoit les citations qui portent ses nombres : elle
 *     est désormais citée, et l'écran peut montrer d'où vient chaque chiffre ;
 *   - sinon, la phrase est RETIRÉE. Un chiffre sans source ne sort jamais.
 *
 * C'est la règle de R2 transposée au droit : un chiffre se relit dans ce
 * qu'on a montré, jamais dans ce que le modèle écrit.
 */
function adosserLesChiffres(affirmations: readonly Affirmation[]): {
  affirmations: Affirmation[];
  retirees: string[];
} {
  const citations = affirmations.flatMap((a) => a.citations);
  const parCitation = citations.map((c) => ({ c, nombres: new Set(nombresDe(c.extrait)) }));
  const identites = citations.map((c) => {
    const r = c.resultat;
    const ident = [
      r.corpus,
      r.type === "article" ? r.numero : `${r.code} ${r.article ?? ""}`,
      r.validFrom ?? "",
      r.validTo ?? "",
    ].join(" ");
    return { c, nombres: new Set(nombresDe(ident)) };
  });

  const sortie: Affirmation[] = [];
  const retirees: string[] = [];
  for (const a of affirmations) {
    if (a.citations.length > 0 || !porteUnChiffre(a.texte)) {
      sortie.push(a);
      continue;
    }
    for (const phrase of phrasesDe(a.texte)) {
      const nombres = nombresDe(phrase);
      if (nombres.length === 0) {
        sortie.push({ texte: phrase, citations: [] });
        continue;
      }
      const portes = new Map<string, CitationRelue>();
      let toutPorte = true;
      for (const n of nombres) {
        const porteuses = [
          ...parCitation.filter((x) => x.nombres.has(n)),
          ...identites.filter((x) => x.nombres.has(n)),
        ];
        if (porteuses.length === 0) {
          toutPorte = false;
          break;
        }
        for (const x of porteuses) portes.set(`${x.c.index}|${x.c.extrait}`, x.c);
      }
      if (toutPorte) sortie.push({ texte: phrase, citations: [...portes.values()] });
      else retirees.push(phrase.replace(/\s+/g, " ").trim());
    }
  }
  return { affirmations: sortie, retirees };
}

/**
 * Ce que Claude a rendu, relu contre ce qu'on lui a envoyé.
 *
 * Une citation tient si son `search_result_index` désigne un résultat envoyé
 * ET si sa `source` est celle de ce résultat. Sinon elle tombe, et elle est
 * comptée : une citation qui ne se relit pas est l'équivalent juridique d'un
 * montant sans jeton.
 */
export function lireLaReponseCitee(
  brute: ReponseClaudeBrute,
  index: readonly ResultatCitable[],
): ReponseCitee {
  const affirmations: Affirmation[] = [];
  let citationsRejetees = 0;

  for (const bloc of brute.content ?? []) {
    if (bloc.type !== "text" || typeof bloc.text !== "string") continue;
    const citations: CitationRelue[] = [];
    for (const c of bloc.citations ?? []) {
      const i = c.search_result_index;
      const r = typeof i === "number" && Number.isInteger(i) ? index[i] : undefined;
      if (c.type !== "search_result_location" || !r || c.source !== r.source) {
        citationsRejetees += 1;
        continue;
      }
      citations.push({ index: i!, resultat: r, extrait: (c.cited_text ?? "").trim() });
    }
    affirmations.push({ texte: bloc.text, citations });
  }

  const adossees = adosserLesChiffres(affirmations);
  const rendues = adossees.affirmations;

  const vues = new Map<string, SourceCiteeVersionnee>();
  const versionsParArticle = new Map<string, Set<string>>();
  for (const a of rendues) {
    for (const c of a.citations) {
      const r = c.resultat;
      if (vues.has(r.source)) continue;
      if (r.type === "article") {
        vues.set(r.source, {
          type: "article",
          corpus: r.corpus,
          numero: r.numero,
          code: null,
          validFrom: r.validFrom,
          validTo: r.validTo,
        });
        const cle = `${r.corpus}|${r.numero}`;
        const versions = versionsParArticle.get(cle) ?? new Set<string>();
        versions.add(r.validFrom ?? "?");
        versionsParArticle.set(cle, versions);
      } else {
        vues.set(r.source, {
          type: "parametre",
          corpus: r.corpus,
          numero: r.article,
          code: r.code,
          validFrom: r.validFrom,
          validTo: r.validTo,
        });
      }
    }
  }

  const nonCitees = rendues
    .filter((a) => a.citations.length === 0)
    .map((a) => a.texte.replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 40);

  return {
    texte: rendues
      .map((a) => a.texte)
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    affirmations: rendues,
    sources: [...vues.values()],
    refus: vues.size === 0,
    citationsRejetees,
    nonCitees,
    chiffresNonCites: rendues
      .filter((a) => a.citations.length === 0 && porteUnChiffre(a.texte))
      .map((a) => a.texte.trim()),
    chiffresRetires: adossees.retirees,
    versionsMelangees: [...versionsParArticle.values()].some((v) => v.size > 1),
    tronquee: brute.stop_reason === "max_tokens",
  };
}

/* ------------------------------------------------------------ le coût -- */

export interface UsageDeLAppel {
  entree: number;
  sortie: number;
  cacheLu: number;
  cacheEcrit: number;
}

export function usageDe(brute: Pick<ReponseClaudeBrute, "usage">): UsageDeLAppel {
  return {
    entree: brute.usage?.input_tokens ?? 0,
    sortie: brute.usage?.output_tokens ?? 0,
    cacheLu: brute.usage?.cache_read_input_tokens ?? 0,
    cacheEcrit: brute.usage?.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Le coût d'un appel, au tarif de la base (R8) — en dollars.
 *
 * `null` si un tarif manque : un coût inconnu ne se dit pas « zéro ».
 */
export function coutDeLAppel(
  modele: string,
  usage: UsageDeLAppel,
  tarifs: readonly TarifDeModele[],
): number | null {
  const tarif = (role: string) => tarifs.find((t) => t.model === modele && t.role === role);
  const chat = tarif("chat");
  if (!chat) return null;
  const lu = usage.cacheLu > 0 ? tarif("cache") : { in: 0 };
  const ecrit = usage.cacheEcrit > 0 ? tarif("cache_ecriture") : { in: 0 };
  if (!lu || !ecrit) return null;
  const dollars =
    (usage.entree * chat.in +
      usage.sortie * chat.out +
      usage.cacheLu * lu.in +
      usage.cacheEcrit * ecrit.in) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
