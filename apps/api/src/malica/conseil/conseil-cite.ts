/**
 * Le conseil cité — la question, le corpus, Claude, et des citations.
 *
 * ================================================================ LE GESTE
 *
 *   1. la base dit si le plafond du mois permet un appel (ANO-029) ;
 *   2. la configuration se lit en base : consigne, réglage, tarifs (R8, R10) ;
 *   3. la question est cherchée dans le corpus, par les vecteurs ET les mots,
 *      dans l'état du droit À LA DATE D'EFFET — une version par article ;
 *   4. les paramètres du référentiel (taux, seuils, délais) s'y ajoutent ;
 *   5. RIEN NE RÉPOND ? On s'arrête là : « je ne trouve pas cela dans les
 *      textes », sans appeler Claude — un refus qui ne coûte rien ;
 *   6. sinon Claude reçoit les passages en résultats citables, Haiku par
 *      défaut, Sonnet si la question est jugée difficile ;
 *   7. l'appel se journalise (chat, cache lu, cache écrit), réussi ou non ;
 *   8. les citations sont relues contre ce qui a été envoyé. Aucune citation
 *      valide : c'est un refus, quoi que dise le texte.
 *
 * ============================================================ CE QUI SORT
 *
 * La réponse, ses sources VERSIONNÉES, la mention « en vigueur au », et la
 * mesure de sa fidélité (phrases non citées, citations rejetées, versions
 * mélangées). L'épreuve (`epreuve-conseil.ts`) lit exactement cela.
 *
 * Ce module ne touche pas au fil de conversation de `ask.ts` ni à
 * l'arbitrage du cabinet : il est la brique « réponse citée », que la chaîne
 * Claude → DeepSeek pourra porter à la fusion.
 */

import { texte } from "@malica/socle/conseil";

import type { PassageTrouve } from "../../depots/corpus.ts";
import type { AppelApi } from "../appel-local.ts";
import {
  choisirLeModele,
  construireLaRequete,
  coutDeLAppel,
  lireConfiguration,
  lireLaReponseCitee,
  motsDeRecherche,
  resultatsCitables,
  usageDe,
  type SourceCiteeVersionnee,
  type UsageDeLAppel,
} from "./cite.ts";
import type { ClientClaude } from "./client-claude.ts";
import { parametresPour, type ParametreFiscal } from "./corpus.ts";

/** Le nom de l'organe au journal des agents. */
export const AGENT_CONSEIL_CITE = "malica.conseil.cite";

export interface DependancesDuConseilCite {
  client: ClientClaude;
  /** L'empreinte de la question, par le modèle du corpus. */
  empreinte: (question: string) => Promise<number[]>;
  /** Aujourd'hui à Tunis, AAAA-MM-JJ : la date d'effet par défaut. */
  aujourdhui?: () => string;
}

export interface SourceAffichee extends SourceCiteeVersionnee {
  nom: string | null;
}

export interface ResultatDuConseilCite {
  reponse: string;
  /** La ligne « En vigueur au … » composée par le code, jamais par le modèle. */
  mention: string | null;
  enVigueurAu: string;
  refus: boolean;
  /** Le corpus n'a rien rendu : Claude n'a pas été appelé. */
  horsCorpus: boolean;
  sources: SourceAffichee[];
  affirmations: Array<{
    texte: string;
    citations: Array<{
      corpus: string;
      numero: string | null;
      code: string | null;
      validFrom: string | null;
      extrait: string;
    }>;
  }>;
  passagesRetenus: Array<{ corpus: string; numero: string; validFrom: string | null }>;
  parametresRetenus: string[];
  modele: string | null;
  difficile: boolean;
  motifDifficulte: string | null;
  consigneId: string;
  usage: UsageDeLAppel;
  coutUsd: number | null;
  latencyMs: number;
  citationsRejetees: number;
  nonCitees: string[];
  chiffresNonCites: string[];
  versionsMelangees: boolean;
  tronquee: boolean;
}

function aujourdhuiATunis(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tunis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(maintenant);
}

function dateLisible(iso: string | null, locale: string): string {
  if (!iso) return "?";
  const [a, m, j] = iso.split("-").map(Number);
  if (!a || !m || !j) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(a, m - 1, j)),
  );
}

/** « En vigueur au 8 novembre 2026 : CIRPPIS art. 52 (version du 1 janvier 2026). » */
export function mentionDeVigueur(
  jour: string,
  sources: readonly SourceAffichee[],
  locale: string,
): string | null {
  const articles = sources.filter((s) => s.type === "article");
  if (articles.length === 0) return null;
  const liste = articles
    .map((s) =>
      texte(locale, "pme.conseil.cite.version", {
        texte: s.nom ?? s.corpus,
        numero: s.numero ?? "",
        date: dateLisible(s.validFrom, locale),
      }),
    )
    .join(" ; ");
  return texte(locale, "pme.conseil.cite.enVigueurAu", { date: dateLisible(jour, locale), liste });
}

const USAGE_NUL: UsageDeLAppel = { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 };

export async function conseilCite(
  api: AppelApi,
  input: { tenantId: string; question: string; locale: string; jour?: string | null | undefined },
  deps: DependancesDuConseilCite,
): Promise<ResultatDuConseilCite> {
  const question = input.question.trim();
  if (question.length < 3) throw new Error("conseil.cite.question_vide");

  const organisations = await api.rpc<Array<{ id: string; jurisdiction: string | null }>>(
    "identite",
    "listMyOrganizations",
    [],
  );
  const organisation = organisations.find((o) => o.id === input.tenantId);
  if (!organisation) throw new Error("organisation introuvable ou non autorisée");
  // R4 : aucune juridiction par défaut.
  if (!organisation.jurisdiction) throw new Error("conseil.cite.juridiction_absente");

  // Avant tout appel payant — l'encodeur compris.
  await api.rpc("conseil", "exigerBudget", [input.tenantId]);

  const configuration = lireConfiguration(
    await api.rpc<unknown>("conseil", "configurationCitee", []),
  );
  const reglage = configuration.reglage;
  const jour = input.jour ?? (deps.aujourdhui ?? aujourdhuiATunis)();

  // L'échec de l'encodeur REMONTE : « je n'ai pas pu chercher » n'est pas
  // « le corpus ne dit rien », et les confondre ferait refuser à tort.
  const vecteur = await deps.empreinte(question);
  const passages = await api.rpc<PassageTrouve[]>("corpus", "rechercherHybride", [
    {
      vecteur,
      mots: motsDeRecherche(question),
      jour,
      nb: reglage.passages_max,
      distanceMax: reglage.distance_max,
      distanceMaxMots: reglage.distance_max_mots,
    },
  ]);

  let parametres: ParametreFiscal[] = [];
  try {
    parametres = await parametresPour(api, {
      jurisdiction: organisation.jurisdiction,
      question,
      fragments: passages,
      jour,
    });
  } catch {
    // Sans paramétrage, Claude n'a pas de chiffre du référentiel : il ne
    // pourra citer que les textes. C'est moins, ce n'est pas faux.
    parametres = [];
  }

  const corpusVus = [...new Set(passages.map((p) => p.corpus))];
  const noms =
    corpusVus.length > 0
      ? await api
          .rpc<Record<string, string>>("conseil", "nomsDesCorpus", [corpusVus])
          .catch(() => ({}) as Record<string, string>)
      : {};
  const { blocs, index } = resultatsCitables(passages, parametres, noms);

  const base = {
    enVigueurAu: jour,
    consigneId: configuration.consigne.id,
    passagesRetenus: passages.map((p) => ({
      corpus: p.corpus,
      numero: p.numero,
      validFrom: p.validFrom,
    })),
    parametresRetenus: parametres.map((p) => p.code),
  };

  if (blocs.length === 0) {
    return {
      ...base,
      reponse: texte(input.locale, "pme.conseil.cite.horsCorpus"),
      mention: null,
      refus: true,
      horsCorpus: true,
      sources: [],
      affirmations: [],
      modele: null,
      difficile: false,
      motifDifficulte: null,
      usage: USAGE_NUL,
      coutUsd: 0,
      latencyMs: 0,
      citationsRejetees: 0,
      nonCitees: [],
      chiffresNonCites: [],
      versionsMelangees: false,
      tronquee: false,
    };
  }

  const choix = choisirLeModele(question, corpusVus.length, reglage);
  const requete = construireLaRequete({
    modele: choix.modele,
    configuration,
    blocs,
    question,
    jour,
    locale: input.locale,
  });

  let envoi: Awaited<ReturnType<ClientClaude["envoyer"]>> | null = null;
  let echec: Error | null = null;
  try {
    envoi = await deps.client.envoyer(requete);
  } catch (err) {
    echec = err instanceof Error ? err : new Error(String(err));
  }

  const usage = envoi ? usageDe(envoi.reponse) : USAGE_NUL;
  await journaliser(api, {
    tenantId: input.tenantId,
    modele: choix.modele,
    usage,
    latencyMs: envoi?.latencyMs ?? 0,
    erreur: echec?.message ?? null,
  });
  if (!envoi) throw echec ?? new Error("Claude indisponible");

  const lu = lireLaReponseCitee(envoi.reponse, index);
  const sources: SourceAffichee[] = lu.sources.map((s) => ({ ...s, nom: noms[s.corpus] ?? null }));

  return {
    ...base,
    reponse: lu.texte,
    mention: lu.refus ? null : mentionDeVigueur(jour, sources, input.locale),
    refus: lu.refus,
    horsCorpus: false,
    sources,
    affirmations: lu.affirmations.map((a) => ({
      texte: a.texte,
      citations: a.citations.map((c) => ({
        corpus: c.resultat.corpus,
        numero: c.resultat.type === "article" ? c.resultat.numero : c.resultat.article,
        code: c.resultat.type === "parametre" ? c.resultat.code : null,
        validFrom: c.resultat.validFrom,
        extrait: c.extrait,
      })),
    })),
    modele: envoi.reponse.model || choix.modele,
    difficile: choix.difficile,
    motifDifficulte: choix.motif,
    usage,
    coutUsd: coutDeLAppel(choix.modele, usage, configuration.tarifs),
    latencyMs: envoi.latencyMs,
    citationsRejetees: lu.citationsRejetees,
    nonCitees: lu.nonCitees,
    chiffresNonCites: lu.chiffresNonCites,
    versionsMelangees: lu.versionsMelangees,
    tronquee: lu.tronquee,
  };
}

/**
 * Le journal des agents : une ligne par rôle tarifé — l'entrée et la sortie
 * au tarif `chat`, le cache lu au tarif `cache`, le cache écrit au tarif
 * `cache_ecriture`. Le plafond du mois mord ainsi sur la facture exacte.
 *
 * Écrit MÊME en cas d'échec : un appel qui a coûté laisse une trace. Son
 * propre échec ne masque pas celui qu'il journalise.
 */
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
      .rpc<string | null>("capture", "journaliserAgent", [
        {
          tenantId: input.tenantId,
          agent: AGENT_CONSEIL_CITE,
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
