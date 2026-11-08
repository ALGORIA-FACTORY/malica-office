/**
 * L'épreuve du conseil cité — ce qu'on attend, et comment on le note.
 *
 * ================================================================ LE JEU
 *
 * `epreuve-conseil.json` porte des questions fiscales tunisiennes ÉCRITES À
 * PARTIR DU CORPUS, jamais de mémoire : chaque cas nomme l'article attendu,
 * sa version (date d'effet), les marqueurs que la réponse doit contenir, et
 * l'EXTRAIT exact du texte qui les porte — recopié de
 * `legal.article_versions` (archive `referentielmalica20260831`). Un cas dont
 * l'extrait ne se retrouve pas dans le corpus est un cas faux, pas une
 * réponse fausse.
 *
 * Et des PIÈGES : droit étranger, hors sujet, et une date où le corpus n'a
 * aucune édition en vigueur. Ils doivent obtenir « je ne trouve pas cela
 * dans les textes ».
 *
 * ================================================================ LA NOTE
 *
 *   réponse juste    pas de refus, et chaque marqueur se lit dans la réponse
 *   citation juste   l'article attendu figure parmi les sources CITÉES, dans
 *                    la version attendue (ou le paramètre du référentiel qui
 *                    se fonde sur lui)
 *   refus correct    un piège obtient un refus
 *   faux refus       une question couverte obtient un refus
 *   coût             au tarif de la base, par question
 *
 * Pur : aucune base, aucun réseau. `epreuve-conseil.test.ts` rejoue le jeu
 * entier avec un Claude simulé ; `tests/real/conseil-cite.ts` le rejoue avec
 * le vrai.
 */

import type { ResultatDuConseilCite } from "./conseil-cite.ts";

interface ArticleAttendu {
  corpus: string;
  numero: string;
  validFrom?: string;
}

export type CasDEpreuve =
  | {
      id: string;
      question: string;
      jour: string;
      locale: "fr" | "en" | "ar";
      attendu: {
        type: "reponse";
        articles: ArticleAttendu[];
        /** Des expressions régulières (insensibles à la casse) que la réponse doit contenir. */
        marqueurs: string[];
        /** Le passage du corpus qui porte la réponse, recopié tel quel. */
        extrait: string;
      };
    }
  | {
      id: string;
      question: string;
      jour: string;
      locale: "fr" | "en" | "ar";
      attendu: { type: "refus"; raison: string };
    };

/** Le jeu, vérifié : un cas mal formé arrête l'épreuve au lieu de fausser la note. */
export function lireLeJeu(brut: unknown): CasDEpreuve[] {
  const cas = (brut as { cas?: unknown })?.cas;
  if (!Array.isArray(cas)) throw new Error("épreuve : le jeu n'a pas de cas");
  const ids = new Set<string>();
  for (const c of cas as CasDEpreuve[]) {
    if (!c?.id || ids.has(c.id))
      throw new Error(`épreuve : identifiant absent ou en double (${c?.id})`);
    ids.add(c.id);
    if (!c.question?.trim()) throw new Error(`épreuve : ${c.id} sans question`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.jour ?? ""))
      throw new Error(`épreuve : ${c.id} sans date d'effet`);
    if (c.attendu?.type === "reponse") {
      if (!c.attendu.articles?.length) throw new Error(`épreuve : ${c.id} sans article attendu`);
      if (!c.attendu.marqueurs?.length) throw new Error(`épreuve : ${c.id} sans marqueur`);
      if (!c.attendu.extrait?.trim()) throw new Error(`épreuve : ${c.id} sans extrait du corpus`);
      for (const m of c.attendu.marqueurs) new RegExp(m, "iu");
    } else if (c.attendu?.type === "refus") {
      if (!c.attendu.raison?.trim()) throw new Error(`épreuve : ${c.id} sans raison du refus`);
    } else {
      throw new Error(`épreuve : ${c.id} sans attendu`);
    }
  }
  return cas as CasDEpreuve[];
}

/** Ce qu'on compare : minuscules, espaces simples, chiffres occidentaux. */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFKC")
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\u066a/g, "%")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/[\u2019`]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function memeNumero(numero: string | null, attendu: string): boolean {
  if (!numero) return false;
  const n = normaliser(numero).trim();
  const a = normaliser(attendu).trim();
  if (n === a) return true;
  // Un paramètre se fonde sur « Article 49-I » : on y cherche le numéro seul.
  const echappe = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9a-z])${echappe}($|[^0-9])`, "iu").test(n);
}

export interface NoteDuCas {
  id: string;
  type: "reponse" | "refus";
  reponseJuste: boolean;
  citationJuste: boolean;
  refusCorrect: boolean;
  fauxRefus: boolean;
  marqueursManquants: string[];
  modele: string | null;
  coutUsd: number | null;
  latencyMs: number;
  nonCitees: number;
  chiffresNonCites: number;
  chiffresRetires: number;
  versionsMelangees: boolean;
  citationsRejetees: number;
}

export function noterLeCas(cas: CasDEpreuve, r: ResultatDuConseilCite): NoteDuCas {
  const commun = {
    id: cas.id,
    modele: r.modele,
    coutUsd: r.coutUsd,
    latencyMs: r.latencyMs,
    nonCitees: r.nonCitees.length,
    chiffresNonCites: r.chiffresNonCites.length,
    chiffresRetires: r.chiffresRetires.length,
    versionsMelangees: r.versionsMelangees,
    citationsRejetees: r.citationsRejetees,
  };

  if (cas.attendu.type === "refus") {
    return {
      ...commun,
      type: "refus",
      reponseJuste: r.refus,
      citationJuste: r.refus,
      refusCorrect: r.refus,
      fauxRefus: false,
      marqueursManquants: [],
    };
  }

  const texte = normaliser(r.reponse);
  const marqueursManquants = cas.attendu.marqueurs.filter((m) => !new RegExp(m, "iu").test(texte));
  const citationJuste = cas.attendu.articles.some((a) =>
    r.sources.some(
      (s) =>
        s.corpus === a.corpus &&
        memeNumero(s.numero, a.numero) &&
        // La version : celle de l'article. Un paramètre porte sa propre date
        // de validité, distincte de l'édition du code ; il n'est pas jugé dessus.
        (s.type === "parametre" || !a.validFrom || s.validFrom === a.validFrom),
    ),
  );
  return {
    ...commun,
    type: "reponse",
    reponseJuste: !r.refus && marqueursManquants.length === 0,
    citationJuste,
    refusCorrect: false,
    fauxRefus: r.refus,
    marqueursManquants,
  };
}

export interface BilanDeLEpreuve {
  questions: number;
  reponses: { total: number; justes: number; citationsJustes: number; fauxRefus: number };
  pieges: { total: number; refusCorrects: number };
  cout: { totalUsd: number; moyenUsd: number; inconnus: number };
  latenceMoyenneMs: number;
  modeles: Record<string, number>;
  affirmationsNonCitees: number;
  chiffresNonCites: number;
  chiffresRetires: number;
  versionsMelangees: number;
  citationsRejetees: number;
}

export function bilanDeLEpreuve(notes: readonly NoteDuCas[]): BilanDeLEpreuve {
  const reponses = notes.filter((n) => n.type === "reponse");
  const pieges = notes.filter((n) => n.type === "refus");
  const couts = notes.map((n) => n.coutUsd).filter((c): c is number => c !== null);
  const total = couts.reduce((a, b) => a + b, 0);
  const modeles: Record<string, number> = {};
  for (const n of notes) {
    const m = n.modele ?? "aucun (refus sans appel)";
    modeles[m] = (modeles[m] ?? 0) + 1;
  }
  const arrondi = (x: number) => Math.round(x * 1_000_000) / 1_000_000;
  return {
    questions: notes.length,
    reponses: {
      total: reponses.length,
      justes: reponses.filter((n) => n.reponseJuste).length,
      citationsJustes: reponses.filter((n) => n.citationJuste).length,
      fauxRefus: reponses.filter((n) => n.fauxRefus).length,
    },
    pieges: { total: pieges.length, refusCorrects: pieges.filter((n) => n.refusCorrect).length },
    cout: {
      totalUsd: arrondi(total),
      moyenUsd: notes.length ? arrondi(total / notes.length) : 0,
      inconnus: notes.length - couts.length,
    },
    latenceMoyenneMs: notes.length
      ? Math.round(notes.reduce((a, n) => a + n.latencyMs, 0) / notes.length)
      : 0,
    modeles,
    affirmationsNonCitees: notes.reduce((a, n) => a + n.nonCitees, 0),
    chiffresNonCites: notes.reduce((a, n) => a + n.chiffresNonCites, 0),
    chiffresRetires: notes.reduce((a, n) => a + n.chiffresRetires, 0),
    versionsMelangees: notes.filter((n) => n.versionsMelangees).length,
    citationsRejetees: notes.reduce((a, n) => a + n.citationsRejetees, 0),
  };
}

/** Le bilan, lisible par un dirigeant. */
export function bilanEnTexte(b: BilanDeLEpreuve): string {
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : "—");
  return [
    `Questions : ${b.questions} (${b.reponses.total} couvertes par le corpus, ${b.pieges.total} pièges)`,
    `Réponses justes : ${b.reponses.justes}/${b.reponses.total} (${pct(b.reponses.justes, b.reponses.total)})`,
    `Citations justes : ${b.reponses.citationsJustes}/${b.reponses.total} (${pct(b.reponses.citationsJustes, b.reponses.total)})`,
    `Refus corrects sur les pièges : ${b.pieges.refusCorrects}/${b.pieges.total}`,
    `Faux refus : ${b.reponses.fauxRefus}`,
    `Coût : ${b.cout.totalUsd} $ au total, ${b.cout.moyenUsd} $ par question` +
      (b.cout.inconnus ? ` (${b.cout.inconnus} coût(s) inconnu(s))` : ""),
    `Latence moyenne : ${b.latenceMoyenneMs} ms`,
    `Modèles : ${Object.entries(b.modeles)
      .map(([m, n]) => `${m} × ${n}`)
      .join(", ")}`,
    `Phrases non citées rendues : ${b.affirmationsNonCitees} (dont ${b.chiffresNonCites} portant un chiffre)`,
    `Phrases chiffrées retirées faute de citation : ${b.chiffresRetires}`,
    `Versions mélangées : ${b.versionsMelangees} · citations rejetées : ${b.citationsRejetees}`,
  ].join("\n");
}
