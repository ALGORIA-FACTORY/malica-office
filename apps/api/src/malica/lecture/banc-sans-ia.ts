/**
 * Le banc sans IA ni GPU : chaque pièce d'un corpus, par la chaîne de
 * production, sans aucun modèle — et chaque concept imprimé compté.
 *
 * ================================================================= LA CHAÎNE
 *
 *   relevé    `relever()` (vision.ts) : la couche de texte d'un PDF, sinon
 *             l'OCR rapide sur CPU (`OCR_URL`, le service ONNX du dépôt),
 *             gardé par pièce dans `--cache` ; ou le plan déjà relevé que le
 *             corpus porte (les jeux du dirigeant) ;
 *   jetons    `jetonsDuSudoku` : montants, dates, identifiants, lettres ;
 *   preuve    `resoudreLaPiece` + le moteur WASM : centre (sommes, lettres),
 *             rangées middle-out, parties, experts nommés ;
 *   contexte  la grille du TYPE de la pièce et le pack, lus en base
 *             (`lireLeContexteDuSudoku`) ; le dossier connu.
 *
 * Aucun désignateur, aucun modèle : ce banc mesure ce que le moteur lit SEUL.
 *
 * ================================================================= LA MESURE
 *
 * Pour chaque champ mesuré :
 *   juste      imprimé, lu, égal à la vérité ;
 *   faux       imprimé, lu, différent — interdit ;
 *   silence    imprimé, non lu (« inconnu ») — honnête, à gagner ;
 *   invente    non imprimé, et pourtant lu — interdit comme le faux.
 * Les champs mesurés sont ceux de la grille quand la vérité du corpus est
 * complète (le jeu d'ALGORIA) ; sinon ceux que la vérité connaît, et « inventé »
 * ne se compte pas. Les rangées du tableau se comptent cellule par cellule.
 * Par pièce, le SENS (achat / vente) des parties : un échange est compté.
 *
 *   OCR_URL=http://127.0.0.1:8095 DATABASE_URL_ADMIN=… \
 *   node --experimental-strip-types apps/api/src/malica/lecture/banc-sans-ia.ts \
 *     --corpus algoria:outils/jeu-algoria --cache <dossier> [--cas 001,002] [--sortie r.json]
 *
 * Corpus : `algoria:<dossier>`, `synthetique:<dossier>`, `dirigeant:<fichier json>`,
 * `photo:<image>:<vérité json>` (une pièce réelle, lue sur place, jamais copiée).
 *
 * Le banc échoue (code 1) dès qu'une valeur affirmée est fausse, qu'une valeur est
 * inventée ou que les parties sont échangées : zéro est la seule mesure acceptée.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import pg from "pg";
import type { DeviseLue } from "@malica/socle/montant-imprime";

import {
  resoudre,
  type ChampDeGrille,
  type EntreeDuSudoku,
  type SortieDuSudoku,
} from "@malica/sudoku";

import { DEVISES_LUES_D_ESSAI } from "../../scan/devise-d-essai.ts";

import {
  champsDeLaGrille,
  jetonsDuSudoku,
  lireLeContexteDuSudoku,
  resoudreLaPiece,
  type ContexteDuSudoku,
} from "./sudoku.ts";
import type { MarqueDeLaPage } from "@malica/socle/ports/malica";

import type { PageToken } from "./token-plan.ts";
import { relever } from "./vision.ts";

/* ============================================================ LES DONNÉES == */

type Concepts = Readonly<Record<string, unknown>>;

/** Une rangée de la vérité, en décimal. */
interface RangeeVraie {
  readonly designation?: string | undefined;
  readonly quantite?: string | undefined;
  readonly prix_unitaire_ht?: string | undefined;
  readonly prix_unitaire_ttc?: string | undefined;
  readonly remise_ligne?: string | undefined;
  readonly montant_ligne_ht?: string | undefined;
  readonly taux_tva_ligne?: string | undefined;
}

interface ReleveGarde {
  readonly tokens: PageToken[];
  /** Les cachets vus sans modèle (le second lecteur) ; absents d'un relevé gardé avant eux. */
  readonly marques?: MarqueDeLaPage[];
  readonly lecteur: string;
  readonly millisecondes: number;
  /** Le premier temps d'une image (le tableau) : quand il est arrivé, et s'il a prouvé. */
  readonly tableau?: { readonly millisecondes: number; readonly prouve: boolean };
}

/** Une pièce du banc, quel que soit son corpus. */
interface PieceDuBanc {
  readonly corpus: string;
  readonly id: string;
  readonly type: string;
  readonly grille: string | null;
  readonly rendu: string;
  readonly langue: string;
  readonly gabarit: string | null;
  readonly devise: string;
  readonly jour: string;
  readonly sens: "achat" | "vente" | null;
  readonly dossier: { readonly matricule: string; readonly raison: string } | null;
  readonly concepts: Concepts;
  readonly confondus: Readonly<Record<string, string>>;
  /** `grille` : la vérité couvre toute la grille ; sinon les seuls champs connus. */
  readonly verite: "complete" | "partielle";
  /**
   * Les champs que la pièce rend faux exprès (un total faux, un montant
   * illisible, une date absente) : la seule lecture juste est de ne rien en
   * dire. Lus, ils sont faux ; tus, ils sont justes.
   */
  readonly interdits?: readonly string[];
  /** `prouve` : la preuve des jetons du tableau, jouée dès leur arrivée (`surLeTableau`). */
  readonly releve: (prouve?: (tokens: PageToken[]) => boolean) => Promise<ReleveGarde>;
}

/**
 * `signale` : le moteur rend une valeur SIGNALÉE (`statut: "signale"`) — une piste à
 * vérifier, qu'il n'affirme pas. Elle n'est ni juste ni fausse : comptée à part, avec,
 * pour la transparence, combien de ces pistes la vérité aurait données fausses
 * (`signaleFaux`).
 */
type Issue = "juste" | "faux" | "silence" | "invente" | "signale";

interface MesureDuChamp {
  readonly champ: string;
  readonly expert: string;
  readonly issue: Issue;
  readonly attendu: unknown;
  readonly lu: string | null;
  /** Une piste signalée que la vérité dit fausse (ou présente quand rien n'est imprimé). */
  readonly signaleFaux?: boolean;
}

export interface MesureDeLaPiece {
  readonly corpus: string;
  readonly id: string;
  readonly type: string;
  readonly grille: string | null;
  readonly rendu: string;
  readonly langue: string;
  readonly gabarit: string | null;
  readonly lecteur: string | null;
  readonly releveMs: number | null;
  /** Le premier temps de l'image : ses millisecondes, et s'il prouvait déjà la pièce. */
  readonly tableau?: ReleveGarde["tableau"] | null;
  readonly sudokuMs: number | null;
  readonly issue: SortieDuSudoku["issue"] | "sans_grille" | "panne";
  readonly raison: string | null;
  readonly sens: {
    readonly attendu: string | null;
    readonly lu: string | null;
    readonly juste: boolean | null;
    readonly raison: string | null;
  };
  readonly champs: readonly MesureDuChamp[];
  readonly erreur?: string;
}

/* ===================================================== LA NORMALISATION === */

/** Un texte comparé sans casse, voyelles courtes, ponctuation ni espaces doublés. */
function texteNormal(v: unknown): string {
  return latins(String(v))
    .normalize("NFKC")
    .toLocaleLowerCase("fr")
    .replace(/[ً-ْـ]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Les chiffres orientaux en chiffres latins. */
function latins(s: string): string {
  return s.replace(/[٠-٩]/gu, (c) => String(c.charCodeAt(0) - 0x0660));
}

/** Un identifiant : lettres et chiffres seuls, en majuscules. */
const identifiantNormal = (v: unknown) =>
  latins(String(v))
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "");

/**
 * La vérité d'un identifiant sans le libellé que sa saisie a gardé en tête (« N° 1547 ») :
 * un repère du champ, ou sa fin (« Facture N° » → « N° »), suivi d'un blanc ou d'un
 * deux-points. Le libellé n'est pas la valeur : le moteur rend « 1547 », que la pièce
 * imprime derrière « N° ». Les repères viennent de la grille, en base.
 */
function sansSonLibelle(attendu: unknown, champ: ChampDeGrille): string {
  const v = String(attendu).trim();
  const libelles = [...champ.reperes_fr, ...champ.reperes_ar].flatMap((r) => {
    const mots = r.trim().split(/\s+/u);
    return mots.map((_, i) => mots.slice(i).join(" "));
  });
  const pris = libelles
    .filter(
      (l) => l && v.toLowerCase().startsWith(l.toLowerCase()) && /^[\s:]/u.test(v.slice(l.length)),
    )
    .sort((a, b) => b.length - a.length)[0];
  return pris ? v.slice(pris.length).replace(/^[\s:]+/u, "") : v;
}

/** Un nombre décimal de la vérité (« 841.849 », 385) en unités de l'exposant. */
export function enUnites(v: unknown, exposant: number): bigint | null {
  if (v === null || v === undefined) return null;
  const s = latins(String(v)).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? "").padEnd(exposant, "0");
  if (frac.length > exposant) return null;
  const n = BigInt(m[2]! + frac);
  return m[1] ? -n : n;
}

/** Une date de la vérité en ISO (« 08/08/2026 » → « 2026-08-08 »). */
export function dateIso(v: unknown): string {
  const s = latins(String(v)).trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : s;
}

const entier = (v: string | null | undefined): bigint | null =>
  v !== null && v !== undefined && /^-?\d+$/u.test(v) ? BigInt(v) : null;

/** Le pourcentage d'un code de taux du barème (`TVA19` → « 19 », `EXO` → « 0 »). */
function pourcentDuTaux(contexte: ContexteDuSudoku, code: string): string {
  for (const bareme of Object.values(contexte.pack.baremes)) {
    const t = bareme.find((x) => x.code === code);
    if (t) return String(t.ppm / 10_000);
  }
  if (Object.values(contexte.pack.taux_nuls ?? {}).some((t) => t.includes(code))) return "0";
  return code;
}

/* ============================================================ LA MESURE ==== */

interface Lecture {
  readonly lu: string | null;
  readonly juste: boolean;
}

function comparer(
  champ: ChampDeGrille,
  attendu: unknown,
  sortie: SortieDuSudoku,
  contexte: ContexteDuSudoku,
  exposant: number,
): Lecture {
  const c = sortie.champs[champ.code];
  // Un champ par taux : la vérité est { "19": "159.951" }, la lecture ses instances.
  if (
    c?.instances !== undefined ||
    (attendu !== null && typeof attendu === "object" && champ.type === "montant")
  ) {
    const lu: Record<string, string> = {};
    for (const i of c?.instances ?? [])
      if (i.valeur !== null) lu[pourcentDuTaux(contexte, i.taux)] = i.valeur;
    if (Object.keys(lu).length === 0) return { lu: null, juste: false };
    const att = (attendu ?? {}) as Record<string, unknown>;
    const juste =
      Object.keys(att).length === Object.keys(lu).length &&
      Object.entries(att).every(([t, v]) => {
        const l = entier(lu[String(Number(t))]);
        return l !== null && enUnites(v, exposant) === l;
      });
    return { lu: JSON.stringify(lu), juste };
  }
  const v = c && c.statut !== "absent" ? c.valeur : null;
  if (v === null || v === undefined) return { lu: null, juste: false };
  if (attendu === null || attendu === undefined) return { lu: v, juste: false };
  switch (champ.type) {
    case "date":
      // Une date-heure de la vérité : le moteur lit la date ; l'heure n'est pas un champ à lui.
      return { lu: v, juste: v === dateIso(attendu).slice(0, 10) };
    case "montant":
      return { lu: v, juste: entier(v) !== null && enUnites(attendu, exposant) === entier(v) };
    case "identifiant":
      return {
        lu: v,
        juste: identifiantNormal(v) === identifiantNormal(sansSonLibelle(attendu, champ)),
      };
    case "booleen":
      return { lu: v, juste: (String(attendu) === "true") === (v !== "false") };
    case "nombre":
    case "taux":
      return { lu: v, juste: Number(latins(v).replace(",", ".")) === Number(attendu) };
    default: {
      // Une coordonnée composite (téléphone, e-mail…) : chaque partie imprimée doit y être.
      if (typeof attendu === "object") {
        const lu = texteNormal(v);
        const parts = Object.values(attendu as Record<string, unknown>).filter(Boolean);
        return { lu: v, juste: parts.every((p) => lu.includes(texteNormal(p))) };
      }
      // Un champ liste à domaine rend un CODE : la vérité (un code, ou le texte imprimé)
      // se ramène au même domaine.
      if (champ.valeurs && champ.valeurs.length > 0) {
        const cle = (x: unknown) => texteNormal(x).replace(/ /gu, "");
        const vrai =
          champ.valeurs.find(
            (d) => cle(d.code) === cle(attendu) || d.formes.some((f) => cle(f) === cle(attendu)),
          )?.code ?? String(attendu);
        // Un titre double (« Bon de Livraison/Facture ») : juste si l'une de ses formes est
        // celle du code lu.
        const formesLues = champ.valeurs.find((d) => d.code === v)?.formes ?? [];
        return {
          lu: v,
          juste: v === vrai || formesLues.some((f) => cle(attendu).includes(cle(f))),
        };
      }
      if (champ.expert === "tiers")
        return { lu: v, juste: nomNormal(v, contexte) === nomNormal(attendu, contexte) };
      return { lu: v, juste: texteNormal(v) === texteNormal(attendu) };
    }
  }
}

/** Une raison sociale sans sa forme juridique (le pack les nomme) ni ses espaces. */
function nomNormal(v: unknown, contexte: ContexteDuSudoku): string {
  const formes = new Set(contexte.formesJuridiques.map((f) => texteNormal(f).replace(/ /gu, "")));
  return texteNormal(v)
    .split(" ")
    .filter((m) => !formes.has(m))
    .join("");
}

/**
 * Le montant en lettres : la vérité est le texte imprimé, le moteur rend le
 * montant qu'il dit. Juste s'il est l'un des totaux à payer de la vérité.
 */
function montantDesLettres(
  sortie: SortieDuSudoku,
  code: string,
  concepts: Concepts,
  exposant: number,
): Lecture {
  const c = sortie.champs[code];
  const v = c && c.statut !== "absent" ? c.valeur : null;
  if (v === null || v === undefined) return { lu: null, juste: false };
  const totaux = ["total_ttc", "net_a_payer", "montant_net_a_payer", "montant_total"]
    .filter((k) => Object.hasOwn(concepts, k))
    .map((k) => enUnites(concepts[k], exposant));
  return { lu: v, juste: totaux.includes(entier(v)) };
}

/** Les cellules du tableau, rangée par rangée, dans l'ordre de la page. */
function mesurerLesRangees(
  sortie: SortieDuSudoku,
  vraies: readonly RangeeVraie[] | undefined,
  contexte: ContexteDuSudoku,
  exposant: number,
): MesureDuChamp[] {
  if (!vraies) return [];
  const lues = sortie.lignes?.instances ?? [];
  const out: MesureDuChamp[] = [];
  const n = Math.max(lues.length, vraies.length);
  const cellule = (champ: string, attendu: unknown, lu: string | null, juste: boolean) => {
    const imprime = attendu !== undefined && attendu !== null;
    const issue: Issue | null = imprime
      ? lu === null
        ? "silence"
        : juste
          ? "juste"
          : "faux"
      : lu === null
        ? null
        : "invente";
    if (issue) out.push({ champ: `lignes.${champ}`, expert: "lignes", issue, attendu, lu });
  };
  for (let i = 0; i < n; i++) {
    const v = vraies[i] ?? {};
    const l = lues[i];
    const prixVrai = l?.prix_ttc
      ? v.prix_unitaire_ttc
      : (v.prix_unitaire_ht ?? v.prix_unitaire_ttc);
    const num = (att: unknown, lu: string | undefined) => ({
      lu: lu ?? null,
      juste: lu !== undefined && enUnites(att, exposant) === entier(lu),
    });
    const q = num(v.quantite, l?.quantite.valeur);
    cellule("quantite", v.quantite, q.lu, q.juste);
    const p = num(prixVrai, l?.prix.valeur);
    cellule("prix", prixVrai, p.lu, p.juste);
    const m = num(v.montant_ligne_ht, l?.montant.valeur);
    cellule("montant", v.montant_ligne_ht, m.lu, m.juste);
    // Une remise de la vérité en fraction (0.08) se lit en pourcentage imprimé (8 %).
    const remiseVraie =
      v.remise_ligne !== undefined && Number(v.remise_ligne) < 1
        ? String(Math.round(Number(v.remise_ligne) * 100_000) / 1000)
        : v.remise_ligne;
    const r = num(remiseVraie, l?.remise?.valeur);
    cellule("remise", remiseVraie, r.lu, r.juste);
    const t = l?.taux ? pourcentDuTaux(contexte, l.taux.code) : null;
    cellule("taux", v.taux_tva_ligne, t, t !== null && Number(t) === Number(v.taux_tva_ligne));
    const d = l?.designation?.valeur ?? null;
    // L'espace qu'un OCR perd ou ajoute n'est pas un mot : la désignation se compare sans lui.
    // Ni l'accent qu'il perd (« boite » pour « boîte ») : la lettre reste la même.
    // Le signe de multiplication et la lettre x se valent dans une dimension (« 160 × 80 »
    // imprimé, « 160 x 80 » dans la vérité) : c'est la même désignation.
    const sansEspace = (x: unknown) =>
      texteNormal(String(x).replace(/×/gu, "x"))
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/gu, "")
        .replace(/ /gu, "");
    // Une vérité arabe saisie dans l'ordre VISUEL (les lettres de droite à gauche rendues de
    // gauche à droite : « ﺓﺩﺭﻮﺘﺴﻣ », 100/D-14 de la couche de texte) est le même texte que sa
    // lecture dans l'ordre logique : elle se compare aussi retournée.
    const vraie = sansEspace(v.designation);
    // (retournée AVANT la normalisation : la ligature « ﻼ » se décompose en lam puis alif)
    const visuelle = /\p{Script=Arabic}/u.test(vraie)
      ? sansEspace([...String(v.designation)].reverse().join(""))
      : null;
    cellule(
      "designation",
      v.designation,
      d,
      d !== null && (sansEspace(d) === vraie || sansEspace(d) === visuelle),
    );
  }
  return out;
}

/* ========================================================= UNE PIÈCE ====== */

async function mesurerLaPiece(
  db: pg.Pool,
  packId: string,
  piece: PieceDuBanc,
  /** Un dossier où garder la sortie brute du moteur et le plan, pour le diagnostic. */
  brut?: string,
  moteur: (entree: EntreeDuSudoku) => SortieDuSudoku = resoudre,
): Promise<MesureDeLaPiece> {
  const base = {
    corpus: piece.corpus,
    id: piece.id,
    type: piece.type,
    grille: piece.grille,
    rendu: piece.rendu,
    langue: piece.langue,
    gabarit: piece.gabarit,
  };
  const sansSens = { attendu: piece.sens, lu: null, juste: null, raison: null };
  const panne = (commun: object, erreur: string): MesureDeLaPiece =>
    ({
      lecteur: null,
      releveMs: null,
      ...base,
      ...commun,
      sudokuMs: null,
      issue: "panne",
      raison: null,
      sens: sansSens,
      champs: [],
      erreur,
    }) as MesureDeLaPiece;
  const devise = DEVISES_LUES_D_ESSAI.find((d) => d.code === piece.devise);
  let contexte: ContexteDuSudoku | null = null;
  if (piece.grille && devise) {
    const client = await db.connect();
    try {
      contexte = await lireLeContexteDuSudoku(
        client,
        packId,
        piece.grille,
        piece.devise,
        piece.jour,
      );
    } catch (e) {
      return panne({}, `contexte : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      client.release();
    }
  }
  const resoudreSur = (
    tokens: PageToken[],
    c: ContexteDuSudoku,
    d: DeviseLue,
    marques: readonly MarqueDeLaPage[] = [],
  ) =>
    resoudreLaPiece(
      jetonsDuSudoku(tokens, d, c),
      c,
      moteur,
      {
        dossier: piece.dossier
          ? { matricule: piece.dossier.matricule, raison_sociale: piece.dossier.raison }
          : null,
        tiers: [],
        formes_juridiques: c.formesJuridiques,
      },
      marques,
    );
  let releve: ReleveGarde;
  try {
    releve = await piece.releve(
      contexte && devise
        ? (tokens) => resoudreSur(tokens, contexte, devise).issue === "prouvee"
        : undefined,
    );
  } catch (e) {
    return panne({}, `relevé : ${e instanceof Error ? e.message : String(e)}`);
  }
  const commun = {
    lecteur: releve.lecteur,
    releveMs: releve.millisecondes,
    tableau: releve.tableau ?? null,
  };
  if (!piece.grille) {
    return {
      ...base,
      ...commun,
      sudokuMs: null,
      issue: "sans_grille",
      raison: null,
      sens: sansSens,
      champs: [],
    };
  }
  if (!devise) return panne(commun, `devise inconnue : ${piece.devise}`);
  if (!contexte) return panne(commun, "contexte absent");
  const t0 = performance.now();
  const sortie = resoudreSur(releve.tokens, contexte, devise, releve.marques);
  const sudokuMs = Math.round(performance.now() - t0);
  if (brut)
    writeFileSync(
      join(brut, `${piece.corpus}-${piece.id.replace(/\W+/gu, "_")}.json`),
      JSON.stringify({ sortie, tokens: releve.tokens }),
    );

  const { concepts, confondus } = piece;
  const lettres = champsDeLaGrille(contexte.grille).lettres;
  const champs: MesureDuChamp[] = [];
  const interdits = new Set(piece.interdits ?? []);
  for (const champ of contexte.grille.champs) {
    if (champ.code === "lignes") continue;
    if (interdits.has(champ.code)) {
      const r = comparer(champ, null, sortie, contexte, devise.decimales);
      champs.push({
        champ: champ.code,
        expert: champ.expert ?? "?",
        issue: r.lu === null ? "juste" : "faux",
        attendu: "(rien : la pièce le rend faux exprès)",
        lu: r.lu,
      });
      continue;
    }
    const source = Object.hasOwn(concepts, champ.code) ? champ.code : confondus[champ.code];
    const imprime = source !== undefined && Object.hasOwn(concepts, source);
    if (!imprime && piece.verite === "partielle") continue;
    const attendu = imprime ? concepts[source] : null;
    let r: Lecture;
    if (champ.code === lettres && imprime)
      r = montantDesLettres(sortie, champ.code, concepts, devise.decimales);
    else {
      r = comparer(champ, attendu, sortie, contexte, devise.decimales);
      // Un champ confondu dont la valeur est une partie de son jumeau (le code TVA dans le matricule).
      if (source !== champ.code && !r.juste && r.lu !== null && champ.type !== "date")
        r = { lu: r.lu, juste: identifiantNormal(attendu).includes(identifiantNormal(r.lu)) };
    }
    const signalee = r.lu !== null && sortie.champs[champ.code]?.statut === "signale";
    const issue: Issue | null = signalee
      ? "signale"
      : imprime
        ? r.lu === null
          ? "silence"
          : r.juste
            ? "juste"
            : "faux"
        : r.lu === null
          ? null
          : "invente";
    if (issue)
      champs.push({
        champ: champ.code,
        expert: champ.expert ?? "?",
        issue,
        attendu,
        lu: r.lu,
        ...(signalee ? { signaleFaux: !imprime || !r.juste } : {}),
      });
  }
  champs.push(
    ...mesurerLesRangees(
      sortie,
      concepts["lignes"] as RangeeVraie[] | undefined,
      contexte,
      devise.decimales,
    ).filter((c) => piece.verite === "complete" || c.issue !== "invente"),
  );
  const sensLu = sortie.parties?.sens ?? null;
  return {
    ...base,
    ...commun,
    sudokuMs,
    issue: sortie.issue,
    raison: sortie.raison ?? null,
    sens: {
      attendu: piece.sens,
      lu: sensLu,
      juste: piece.sens === null || sensLu === null ? null : piece.sens === sensLu,
      raison: sortie.parties?.raison ?? null,
    },
    champs,
  };
}

/* ========================================================== LES CORPUS ==== */

const JOUR_PAR_DEFAUT = "2026-10-01";
const jourDe = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v) ? v : JOUR_PAR_DEFAUT;

/** Le relevé de production d'un fichier, gardé en cache. */
function releveDuFichier(chemin: string, garde: string): PieceDuBanc["releve"] {
  return async (prouve) => {
    if (existsSync(garde)) return JSON.parse(readFileSync(garde, "utf8")) as ReleveGarde;
    const mime = chemin.endsWith(".pdf")
      ? "application/pdf"
      : chemin.endsWith(".png")
        ? "image/png"
        : "image/jpeg";
    const octets = new Uint8Array(readFileSync(chemin));
    const t0 = performance.now();
    let tableau: ReleveGarde["tableau"];
    const r = await relever({
      dataUrl: `data:${mime};base64,${Buffer.from(octets).toString("base64")}`,
      mime,
      bytes: octets,
      ...(prouve
        ? {
            surLeTableau: (tokens: PageToken[]) => {
              const prouveAuTableau = prouve(tokens);
              tableau = {
                millisecondes: Math.round(performance.now() - t0),
                prouve: prouveAuTableau,
              };
            },
          }
        : {}),
    });
    const g: ReleveGarde = {
      tokens: r.tokens,
      marques: r.marques,
      lecteur: r.lecteur,
      millisecondes: Math.round(performance.now() - t0),
      ...(tableau ? { tableau } : {}),
    };
    writeFileSync(garde, JSON.stringify(g));
    return g;
  };
}

function rendu(dossier: string, id: string): string | null {
  for (const ext of ["pdf", "jpg", "png"]) {
    const f = join(dossier, "rendus", `${id}.${ext}`);
    if (existsSync(f)) return f;
  }
  return null;
}

const lireJson = <T>(f: string): T => JSON.parse(readFileSync(f, "utf8")) as T;

/** Le jeu d'ALGORIA : la vérité couvre toute la grille de chaque pièce. */
function corpusAlgoria(dossier: string, cache: string, deviseDuPack: string): PieceDuBanc[] {
  interface Cas {
    id: string;
    type: string;
    grille: string | null;
    rendu: string;
    langue: string;
    gabarit?: string;
    piece: { devise?: string; client?: { nom?: string } };
    dossier: { nom: string; identifiantFiscal: string };
    attendu: { concepts: Concepts; confondus?: Record<string, string> };
  }
  return readdirSync(join(dossier, "cas"))
    .filter((f) => /^\d+\.json$/u.test(f))
    .sort()
    .map((f) => {
      const cas = lireJson<Cas>(join(dossier, "cas", f));
      const c = cas.attendu.concepts;
      const algoriaCliente = /ALGORIA/iu.test(cas.piece.client?.nom ?? "");
      const sens =
        cas.type === "facture_achat"
          ? "achat"
          : cas.type === "facture_vente"
            ? "vente"
            : cas.type === "avoir"
              ? algoriaCliente
                ? "achat"
                : "vente"
              : null;
      const fichier = rendu(dossier, cas.id);
      return {
        corpus: "algoria",
        id: cas.id,
        type: cas.type,
        grille: cas.grille,
        rendu: cas.rendu,
        langue: cas.langue,
        gabarit: cas.gabarit ?? null,
        devise: cas.piece.devise ?? deviseDuPack,
        jour: jourDe(c["date_operation"] ?? c["date_emission"] ?? c["date_document"]),
        sens,
        dossier: { matricule: cas.dossier.identifiantFiscal, raison: cas.dossier.nom },
        concepts: c,
        confondus: cas.attendu.confondus ?? {},
        verite: "complete",
        releve: fichier
          ? releveDuFichier(fichier, join(cache, `algoria-${cas.id}.json`))
          : () => Promise.reject(new Error("rendu absent")),
      } satisfies PieceDuBanc;
    });
}

/** Le pourcentage d'un code de taxe du jeu synthétique (`TVA19` → « 19 »). */
const pourcentDuCode = (code: string) => /(\d+)$/u.exec(code)?.[1] ?? code;

/** Ce qu'un défaut voulu du jeu synthétique rend faux : le moteur doit s'en taire. */
const TOTAUX = ["total_ht", "total_ttc", "montant_tva_par_taux", "base_tva_par_taux"];
const INTERDITS_DU_DEFAUT: Readonly<Record<string, readonly string[]>> = {
  total_faux: TOTAUX,
  tva_fausse: TOTAUX,
  montant_illisible: TOTAUX,
  date_absente: ["date_operation", "date_emission"],
};

/** Le jeu synthétique : sa vérité nomme les chemins de la lecture, traduits en champs. */
function corpusSynthetique(dossier: string, cache: string, deviseDuPack: string): PieceDuBanc[] {
  interface Cas {
    id: string;
    rendu: string;
    langue: string;
    scenario?: string;
    defaut?: string | null;
    dossier: { nom: string; identifiantFiscal: string };
    piece: { sens: string; devise?: string };
    attendu: { champs: Record<string, string> };
  }
  return readdirSync(join(dossier, "cas"))
    .filter((f) => /^\d+\.json$/u.test(f))
    .sort()
    .map((f) => {
      const cas = lireJson<Cas>(join(dossier, "cas", f));
      const a = cas.attendu.champs;
      const c: Record<string, unknown> = {};
      const poser = (champ: string, chemin: string) => {
        if (a[chemin] !== undefined) c[champ] = a[chemin];
      };
      poser("raison_sociale_emetteur", "issuer");
      poser("date_operation", "document_date");
      poser("numero_facture", "references.numero");
      poser("matricule_fiscal_emetteur", "references.matricule_fiscal");
      poser("matricule_fiscal_client", "references.matricule_fiscal_client");
      poser("total_ht", "totals.base_ht");
      poser("total_ttc", "totals.ttc");
      const bases: Record<string, string> = {};
      const tva: Record<string, string> = {};
      const rangees: RangeeVraie[] = [];
      for (const [k, v] of Object.entries(a)) {
        const l = /^lines\[(\d+)\]\.tax_code$/u.exec(k);
        if (l) {
          const t = pourcentDuCode(v);
          if (a[`lines[${l[1]}].base_ht`]) bases[t] = a[`lines[${l[1]}].base_ht`]!;
          if (a[`lines[${l[1]}].vat_amount`]) tva[t] = a[`lines[${l[1]}].vat_amount`]!;
        }
        const o = /^other_charges\[(\d+)\]\.code$/u.exec(k);
        if (o) {
          const champ =
            v === "DROIT_TIMBRE" ? "droit_timbre" : v === "FODEC" ? "montant_fodec" : null;
          if (champ && a[`other_charges[${o[1]}].amount`])
            c[champ] = a[`other_charges[${o[1]}].amount`];
        }
        const r = /^articles\[(\d+)\]\.quantity$/u.exec(k);
        if (r) {
          const i = Number(r[1]);
          rangees[i] = {
            quantite: v,
            prix_unitaire_ht: a[`articles[${i}].unit_price_ht`],
            montant_ligne_ht: a[`articles[${i}].total_ht`],
          };
        }
      }
      if (Object.keys(bases).length) c["base_tva_par_taux"] = bases;
      if (Object.keys(tva).length) c["montant_tva_par_taux"] = tva;
      if (rangees.length) c["lignes"] = rangees;
      const sens =
        cas.piece.sens === "facture_achat"
          ? "achat"
          : cas.piece.sens === "facture_vente"
            ? "vente"
            : null;
      const fichier = rendu(dossier, cas.id);
      return {
        corpus: "synthetique",
        id: cas.id,
        type: cas.piece.sens,
        grille: "facture",
        rendu: cas.rendu,
        langue: cas.langue,
        gabarit: cas.scenario ?? null,
        devise: cas.piece.devise ?? a["currency"] ?? deviseDuPack,
        jour: jourDe(a["document_date"]),
        sens,
        dossier: { matricule: cas.dossier.identifiantFiscal, raison: cas.dossier.nom },
        concepts: c,
        confondus: { date_emission: "date_operation" },
        verite: "partielle",
        ...(cas.defaut ? { interdits: INTERDITS_DU_DEFAUT[cas.defaut] ?? [] } : {}),
        releve: fichier
          ? releveDuFichier(fichier, join(cache, `synthetique-${cas.id}.json`))
          : () => Promise.reject(new Error("rendu absent")),
      } satisfies PieceDuBanc;
    });
}

/** La grille qui lit un type des jeux du dirigeant. */
const GRILLE_DU_DIRIGEANT: Readonly<Record<string, string>> = {
  facture: "facture",
  honoraires: "facture",
  "facture d'acompte": "facture",
  avoir: "avoir",
  proforma: "devis_proforma",
  devis: "devis_proforma",
  "devis / pro forma": "devis_proforma",
  bon_livraison: "bon_livraison",
  "bon de livraison": "bon_livraison",
  ticket: "ticket_caisse",
  "ticket de caisse": "ticket_caisse",
  recu: "recu_quittance",
  bon_commande: "bon_commande",
  "quittance d'assurance": "avis_echeance_assurance",
  "avis de débit bancaire": "avis_debit",
};

/** Les jeux du dirigeant (100 et 50) : le plan relevé sur le staging, et leur vérité. */
function corpusDuDirigeant(fichier: string, deviseDuPack: string): PieceDuBanc[] {
  interface Rangee {
    qte: number | null;
    pu_ht: number | null;
    montant_ht: number | null;
    taux_tva: number | null;
    remise: number | null;
    designation: string | null;
  }
  interface Jeu {
    id: string;
    verite: {
      entete: Record<string, string | null>;
      lignes: Rangee[] | null;
    };
    jetons: [number, number, string, number, number, number, number, ...unknown[]][];
  }
  return lireJson<Jeu[]>(fichier).map((j) => {
    const e = j.verite.entete;
    const type = (e["type"] ?? "facture").toLowerCase();
    const c: Record<string, unknown> = {};
    const poser = (champ: string, v: string | null | undefined) => {
      if (v) c[champ] = v;
    };
    poser("numero_facture", e["numero"]);
    poser("date_operation", e["date"]);
    poser("date_echeance", e["echeance"]);
    poser("matricule_fiscal_emetteur", e["mf_fournisseur"]);
    poser("matricule_fiscal_client", e["mf_client"]);
    poser("raison_sociale_emetteur", e["fournisseur"]);
    poser("nom_client", e["client"]);
    const dec = (x: number | null) => (x === null ? undefined : String(x));
    if (j.verite.lignes)
      c["lignes"] = j.verite.lignes.map((l) => ({
        designation: l.designation ?? undefined,
        quantite: dec(l.qte),
        prix_unitaire_ht: dec(l.pu_ht),
        montant_ligne_ht: dec(l.montant_ht),
        remise_ligne: dec(l.remise),
        // Le taux de la rangée n'est pas imprimé sur ces tableaux : la vérité le déduit.
      }));
    const algoria = /ALGORI/iu.test(e["client"] ?? "");
    return {
      corpus: "dirigeant",
      id: j.id,
      type,
      grille: GRILLE_DU_DIRIGEANT[type] ?? "facture",
      rendu: "photo",
      langue: "fr",
      gabarit: j.id.split("-")[0] ?? null,
      devise: deviseDuPack,
      jour: jourDe(e["date"]),
      sens: algoria && GRILLE_DU_DIRIGEANT[type] === "facture" ? "achat" : null,
      dossier:
        e["mf_client"] && algoria ? { matricule: e["mf_client"], raison: e["client"] ?? "" } : null,
      concepts: c,
      confondus: { date_emission: "date_operation" },
      verite: "partielle",
      releve: () =>
        Promise.resolve({
          tokens: j.jetons.map(([page, ordinal, text, x0, y0, x1, y1]) => ({
            page,
            ordinal,
            text,
            x0,
            y0,
            x1,
            y1,
          })),
          lecteur: "plan du staging",
          millisecondes: 0,
        }),
    } satisfies PieceDuBanc;
  });
}

/**
 * Une pièce réelle, lue sur place (jamais copiée dans le dépôt) : l'image, et une
 * vérité JSON `{ type, grille, sens, dossier, concepts }` tenue à côté d'elle.
 */
function corpusPhoto(
  image: string,
  verite: string,
  cache: string,
  deviseDuPack: string,
): PieceDuBanc[] {
  const v = lireJson<{
    type: string;
    grille: string;
    sens: "achat" | "vente" | null;
    dossier: { matricule: string; raison: string } | null;
    concepts: Concepts;
  }>(verite);
  return [
    {
      corpus: "reel",
      id: basename(image),
      type: v.type,
      grille: v.grille,
      rendu: "photo",
      langue: "fr",
      gabarit: null,
      devise: deviseDuPack,
      jour: jourDe(v.concepts["date_operation"]),
      sens: v.sens,
      dossier: v.dossier,
      concepts: v.concepts,
      confondus: { date_emission: "date_operation" },
      verite: "partielle",
      releve: releveDuFichier(image, join(cache, `reel-${basename(image)}.json`)),
    },
  ];
}

function chargerLeCorpus(spec: string, cache: string, deviseDuPack: string): PieceDuBanc[] {
  const [genre, ...reste] = spec.split(":");
  const chemin = resolve(reste[0] ?? "");
  switch (genre) {
    case "algoria":
      return corpusAlgoria(chemin, cache, deviseDuPack);
    case "synthetique":
      return corpusSynthetique(chemin, cache, deviseDuPack);
    case "dirigeant":
      return corpusDuDirigeant(chemin, deviseDuPack);
    case "photo":
      return corpusPhoto(chemin, resolve(reste[1] ?? ""), cache, deviseDuPack);
    default:
      throw new Error(`corpus inconnu : ${spec}`);
  }
}

/* ============================================================ LE RAPPORT == */

type Compte = Record<Issue, number>;
const zero = (): Compte => ({ juste: 0, faux: 0, silence: 0, invente: 0, signale: 0 });

export function rapport(mesures: readonly MesureDeLaPiece[]): string {
  const par = (cle: (m: MesureDeLaPiece, c: MesureDuChamp) => string) => {
    const t = new Map<string, Compte>();
    for (const m of mesures)
      for (const c of m.champs) {
        const k = cle(m, c);
        const x = t.get(k) ?? zero();
        x[c.issue]++;
        t.set(k, x);
      }
    return [...t.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const ligne = (k: string, x: Compte) => {
    const imprimes = x.juste + x.faux + x.silence + x.signale;
    const pct = imprimes ? ((100 * x.juste) / imprimes).toFixed(1) : "—";
    return `| ${k} | ${x.juste} | ${x.faux} | ${x.silence} | ${x.invente} | ${x.signale} | ${pct} % |`;
  };
  const tete = (t: string) => [
    `\n### ${t}\n`,
    "| | juste | faux | silence | inventé | signalé (à vérifier) | juste / imprimés |",
    "|---|--:|--:|--:|--:|--:|--:|",
  ];
  const total = zero();
  for (const m of mesures) for (const c of m.champs) total[c.issue]++;
  const sens = mesures.filter((m) => m.sens.attendu !== null);
  const issues = new Map<string, number>();
  for (const m of mesures) issues.set(m.issue, (issues.get(m.issue) ?? 0) + 1);
  const raisons = new Map<string, number>();
  for (const m of sens)
    if (m.sens.lu === null)
      raisons.set(m.sens.raison ?? "?", (raisons.get(m.sens.raison ?? "?") ?? 0) + 1);
  const ocr = mesures
    .filter((m) => m.releveMs && m.lecteur !== "pdf-text")
    .map((m) => m.releveMs!)
    .sort((a, b) => a - b);
  const auTableau = mesures
    .filter((m) => m.tableau?.prouve)
    .map((m) => m.tableau!.millisecondes)
    .sort((a, b) => a - b);
  return [
    `## Banc sans IA — ${mesures.length} pièces (${[...new Set(mesures.map((m) => m.corpus))].join(", ")})`,
    "",
    `- Issues du Sudoku : ${[...issues].map(([k, n]) => `${k} ${n}`).join(" · ")}`,
    `- Sens des parties : ${sens.filter((m) => m.sens.juste).length} justes / ${sens.length} attendus ; échangés : ${
      sens
        .filter((m) => m.sens.juste === false)
        .map((m) => m.id)
        .join(", ") || "aucun"
    } ; non dits : ${[...raisons].map(([k, n]) => `${k} (${n})`).join(", ") || "aucun"}`,
    ocr.length
      ? `- OCR CPU : médiane ${ocr[Math.floor(ocr.length / 2)]} ms, max ${ocr.at(-1)} ms (${ocr.length} images)`
      : "",
    auTableau.length
      ? `- Pièces prouvées dès le tableau (premier temps) : ${auTableau.length}, en ${auTableau[Math.floor(auTableau.length / 2)]} ms médians`
      : "",
    ...tete("Total"),
    ligne("tous les champs", total),
    "",
    `Pistes signalées (non affirmées) : ${total.signale}, dont ${
      mesures.flatMap((m) => m.champs).filter((c) => c.signaleFaux).length
    } que la vérité dit fausses.`,
    ...tete("Par corpus"),
    ...par((m) => m.corpus).map(([k, x]) => ligne(k, x)),
    ...tete("Par famille d'experts"),
    ...par((_, c) => c.expert).map(([k, x]) => ligne(k, x)),
    ...tete("Par grille"),
    ...par((m) => m.grille ?? "—").map(([k, x]) => ligne(k, x)),
    ...tete("Par rendu"),
    ...par((m) => m.rendu).map(([k, x]) => ligne(k, x)),
    ...tete("Par langue"),
    ...par((m) => m.langue).map(([k, x]) => ligne(k, x)),
    ...tete("Par champ"),
    ...par((_, c) => c.champ).map(([k, x]) => ligne(k, x)),
  ].join("\n");
}

/* ============================================================== L'ENTRÉE == */

async function principal(): Promise<void> {
  const { values } = parseArgs({
    options: {
      corpus: { type: "string", multiple: true },
      cache: { type: "string" },
      cas: { type: "string" },
      sortie: { type: "string" },
      brut: { type: "string" },
      "moteur-natif": { type: "string" },
      // Garder l'entrée du moteur de chaque pièce : de quoi en faire une épreuve du moteur.
      entrees: { type: "string" },
      juridiction: { type: "string" },
    },
  });
  const base = process.env["DATABASE_URL_ADMIN"];
  if (!base) throw new Error("DATABASE_URL_ADMIN absente");
  const cache = resolve(values.cache ?? ".releves");
  mkdirSync(cache, { recursive: true });
  if (values.brut) mkdirSync(values.brut, { recursive: true });
  const voulus = values.cas ? new Set(values.cas.split(",")) : null;
  // Le moteur natif (`cargo build --release --example resoudre`) : le même code que
  // le WebAssembly, là où la cible wasm32 ne s'installe pas.
  const natif = values["moteur-natif"];
  const moteur = natif
    ? (entree: EntreeDuSudoku) =>
        JSON.parse(
          execFileSync(resolve(natif), {
            input: JSON.stringify(entree),
            maxBuffer: 64 << 20,
          }).toString(),
        ) as SortieDuSudoku
    : resoudre;
  const entrees = values.entrees;
  if (entrees) mkdirSync(entrees, { recursive: true });
  const db = new pg.Pool({ connectionString: base, max: 2 });
  try {
    // Le pack de la juridiction (`--juridiction`, celle des corpus du dépôt par défaut) : sa
    // devise est celle d'une pièce qui ne dit pas la sienne.
    const juridiction = values.juridiction ?? "TN";
    const { rows } = await db.query<{ id: string; currency: string }>(
      `select id, currency from ref_packs_v where jurisdiction = $2 and effective_from <= $1::date
        order by effective_from desc limit 1`,
      [JOUR_PAR_DEFAUT, juridiction],
    );
    if (rows.length !== 1) throw new Error(`aucun pack ${juridiction} en vigueur`);
    const pieces = (values.corpus ?? [])
      .flatMap((s) => chargerLeCorpus(s, cache, rows[0]!.currency))
      .filter((p) => !voulus || voulus.has(p.id));
    const mesures: MesureDeLaPiece[] = [];
    for (const p of pieces) {
      let appel = 0;
      const garde = (entree: EntreeDuSudoku) => {
        if (entrees)
          writeFileSync(
            join(entrees, `${p.corpus}-${p.id.replace(/\W+/gu, "_")}-${appel++}.json`),
            JSON.stringify(entree),
          );
        return moteur(entree);
      };
      const m = await mesurerLaPiece(db, rows[0]!.id, p, values.brut, garde);
      mesures.push(m);
      const n = (i: Issue) => m.champs.filter((c) => c.issue === i).length;
      console.error(
        `${m.corpus} ${m.id} ${m.type} ${m.issue} — juste ${n("juste")} faux ${n("faux")} silence ${n("silence")} inventé ${n("invente")} signalé ${n("signale")}` +
          `${m.sens.juste === false ? " ÉCHANGE" : ""} ${m.releveMs ?? "-"} ms ${m.erreur ?? ""}`,
      );
    }
    if (values.sortie) writeFileSync(values.sortie, JSON.stringify(mesures));
    console.log(rapport(mesures));
    // Le banc BLOQUE : une valeur affirmée fausse, une valeur inventée ou des parties
    // échangées font échouer la mesure. Une piste signalée ne bloque pas : elle n'est pas
    // affirmée.
    const fautes = mesures.flatMap((m) => [
      ...m.champs
        .filter((c) => c.issue === "faux" || c.issue === "invente")
        .map((c) => `${m.corpus} ${m.id} ${c.champ} : ${c.issue} (lu ${c.lu})`),
      ...(m.sens.juste === false ? [`${m.corpus} ${m.id} : parties échangées`] : []),
    ]);
    if (fautes.length > 0) {
      console.error(
        `\n${fautes.length} valeur(s) affirmée(s) fausse(s) ou inventée(s) :\n${fautes.join("\n")}`,
      );
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
