/**
 * LA RELECTURE CIBLÉE PAR CLAUDE — relire les cases de montant d'une pièce que le Sudoku
 * n'a pas prouvée, et ne croire la relecture que si le Sudoku referme la pièce avec elle.
 *
 * ================================================================== LA DÉCISION
 *
 * 8 novembre 2026, décision du dirigeant : la relecture ciblée est ACTIVÉE, avec Haiku, en
 * arrière-plan. Mesurée sur le banc (`outils/relecture-claude/`, trois passages) : +5
 * pièces prouvées, aucun faux, 0,0006 $ par pièce relue, appel 2,5 s en médiane.
 *
 * ================================================================== L'EXCEPTION À R2
 *
 * R2 dit : « le modèle qui désigne ne voit jamais la pièce ». Ici un modèle VOIT un
 * morceau de la pièce — c'est l'exception que le dirigeant a décidée, et elle est bornée :
 *
 *   - le modèle ne désigne rien et ne décide d'aucune valeur : il TRANSCRIT les caractères
 *     d'une case découpée (la ligne entière ne sert que de contexte), ou dit « illisible » ;
 *   - sa transcription n'est qu'un CANDIDAT : elle remplace le texte du jeton OCR dans une
 *     copie du plan, et la pièce n'est prouvée que si le Sudoku referme TOUTES ses
 *     contraintes avec elle (`sudoku.sansIa`, les exigences de l'écriture comprises) ;
 *   - sinon rien ne change : la lecture d'avant reste, et la personne reçoit un motif
 *     précis (« le total en bas à droite ne se lit pas, vérifiez cette case »).
 *
 * Les valeurs restent relues dans le plan, jamais dans la réponse du modèle : c'est le
 * jeton candidat qui porte la citation, et le Sudoku qui l'affirme.
 *
 * ================================================================== CE FICHIER
 *
 * Le choix des cases, leur découpe, la requête et la lecture de la réponse, le plan
 * candidat, le motif. Il ne connaît ni la base, ni la file, ni le réseau : l'appel est
 * injecté, et le flux (`read-flow.ts`, `verifierLesCases`) branche le reste. Le modèle et
 * la consigne viennent de la base (R8, R10), jamais d'ici.
 *
 * Portage fidèle de l'outil de mesure (`outils/relecture-claude/relire.py`) : mêmes cases,
 * même ordre, même découpe, même réduction de la réponse à son montant. Ce qui a été
 * mesuré est ce qui tourne.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { PageToken } from "./token-plan.ts";

/* ====================================================== LES CASES À RELIRE === */

const SEPARATEURS = ".,،٫٬";
const CHIFFRES = "0123456789٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
/** Ce qu'un lecteur latin fait d'un chiffre (« VA,517 » pour « ٧٨,٢٣٦ »). */
const SOSIES = "OoIlLSBZAVTEYrqgGbn|)(*-";

const echapper = (s: string) => s.replace(/[\\\]^-]/gu, "\\$&");
/*
 * La fin d'un montant : un séparateur, puis un à quatre chiffres, sosies ou points. « + » et
 * « , » y sont admis comme dans l'outil mesuré, où la classe `*-.` formait l'intervalle
 * `*+,-.` : ce qui a été mesuré est ce qui tourne.
 */
const FIN_DE_MONTANT = new RegExp(
  `[${echapper(SEPARATEURS)}][${echapper(CHIFFRES + SOSIES)}.…+,]{1,4}[.*]?$`,
  "u",
);
const UN_SOSIE = new RegExp(`[${echapper(SOSIES)}]`, "u");

/**
 * Un montant tunisien, ou ce qu'un lecteur latin en fait : des chiffres (latins ou
 * orientaux) ou leurs sosies, avec un séparateur près de la fin. Un timbre dont les zéros
 * sont perdus (« 1,... ») reste une case de montant.
 */
export function estUneCaseDeMontant(texte: string): boolean {
  const t = [...texte.replace(/\s/gu, "")];
  if (t.length < 2 || t.length > 22 || !t.some((c) => SEPARATEURS.includes(c))) return false;
  if (!FIN_DE_MONTANT.test(t.join(""))) return false;
  const proches = t.filter(
    (c) => CHIFFRES.includes(c) || SOSIES.includes(c) || SEPARATEURS.includes(c) || ".…".includes(c),
  ).length;
  const chiffres = t.filter((c) => CHIFFRES.includes(c)).length;
  const sosies = t.filter((c) => SOSIES.includes(c)).length;
  return proches / t.length >= 0.8 && (chiffres >= 1 || sosies >= 2);
}

/**
 * Les cases que la relecture regarde, de la première page : d'abord les lectures étranges
 * (un sosie de chiffre), puis du bas vers le haut — les totaux sont en bas. Bornées par le
 * réglage de la tour (`cases_max`).
 */
export function casesARelire(tokens: readonly PageToken[], max: number): PageToken[] {
  return tokens
    .filter((t) => t.page === 1 && estUneCaseDeMontant(t.text))
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        Number(!UN_SOSIE.test(a.t.text)) - Number(!UN_SOSIE.test(b.t.text)) ||
        b.t.y0 - a.t.y0 ||
        a.i - b.i,
    )
    .slice(0, Math.max(0, max))
    .map(({ t }) => t);
}

/* ============================================================ LA DÉCOUPE === */

/** Une case prête à partir : son identifiant dans la requête, son jeton, ses deux images. */
export interface CaseDecoupee {
  readonly id: string;
  readonly jeton: PageToken;
  /** La case agrandie, JPEG en base64 : c'est elle, et elle seule, qui se transcrit. */
  readonly kase: string;
  /** La ligne entière, JPEG en base64 : le contexte (libellé, colonne). */
  readonly ligne: string;
}

const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/**
 * Découper les cases dans l'image de la page : la case avec une marge (0,6 hauteur de
 * côté, 0,35 en haut et en bas) agrandie pour viser 64 pixels de haut (×1 à ×4), et la
 * ligne entière (0,8 hauteur de marge) ramenée à 1 000 pixels de large au plus.
 */
export async function decouper(
  image: Uint8Array | string,
  cases: readonly PageToken[],
): Promise<CaseDecoupee[]> {
  const img = await loadImage(typeof image === "string" ? image : Buffer.from(image));
  const w = img.width;
  const h = img.height;
  const jpeg = (sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) => {
    const toile = createCanvas(Math.max(1, Math.round(dw)), Math.max(1, Math.round(dh)));
    toile.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, toile.width, toile.height);
    return base64(toile.toDataURL("image/jpeg", 0.92));
  };
  return cases.map((t, i) => {
    const x0 = t.x0 * w;
    const y0 = t.y0 * h;
    const x1 = t.x1 * w;
    const y1 = t.y1 * h;
    const hc = Math.max(8, y1 - y0);
    const cx0 = Math.max(0, x0 - 0.6 * hc);
    const cy0 = Math.max(0, y0 - 0.35 * hc);
    const cx1 = Math.min(w, x1 + 0.6 * hc);
    const cy1 = Math.min(h, y1 + 0.35 * hc);
    const cw = Math.max(1, cx1 - cx0);
    const ch = Math.max(1, cy1 - cy0);
    const k = Math.max(1, Math.min(4, 64 / ch));
    const ly0 = Math.max(0, y0 - 0.8 * hc);
    const ly1 = Math.min(h, y1 + 0.8 * hc);
    const lh = Math.max(1, ly1 - ly0);
    const kl = w > 1000 ? 1000 / w : 1;
    return {
      id: `C${i + 1}`,
      jeton: t,
      kase: jpeg(cx0, cy0, cw, ch, cw * k, ch * k),
      ligne: jpeg(0, ly0, w, lh, w * kl, lh * kl),
    };
  });
}

/* ===================================================== LA REQUÊTE, LA RÉPONSE === */

/** Ce que le modèle rend pour une case : ses caractères exacts, ou illisible. */
export interface CaseRelue {
  readonly id: string;
  readonly texte: string;
  readonly lisible: boolean;
}

/** Le schéma strict de la réponse (`output_config.format`) : un tableau de cases. */
export const SCHEMA_DE_LA_REPONSE = {
  type: "object",
  properties: {
    cellules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          texte: { type: "string" },
          lisible: { type: "boolean" },
        },
        required: ["id", "texte", "lisible"],
        additionalProperties: false,
      },
    },
  },
  required: ["cellules"],
  additionalProperties: false,
} as const;

/** Une sortie courte : une poignée de cases transcrites. */
const SORTIE_MAX_JETONS = 2048;

/**
 * Le corps de la requête pour un lot de cases : la consigne en prompt système, mis en
 * cache (elle est la même pour chaque pièce), et pour chaque case la ligne puis la case.
 * L'effort est bas : on transcrit, on ne raisonne pas.
 */
export function corpsDeLaRequete(
  modele: string,
  consigne: string,
  lot: readonly CaseDecoupee[],
): unknown {
  const image = (data: string) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data },
  });
  return {
    model: modele,
    max_tokens: SORTIE_MAX_JETONS,
    system: [{ type: "text", text: consigne, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...lot.flatMap((c) => [
            { type: "text", text: `${c.id} — la ligne (contexte) :` },
            image(c.ligne),
            { type: "text", text: `${c.id} — la case à transcrire :` },
            image(c.kase),
          ]),
          {
            type: "text",
            text: `Rends le JSON des cases ${lot.map((c) => c.id).join(", ")}.`,
          },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: SCHEMA_DE_LA_REPONSE }, effort: "low" },
  };
}

/** La réponse de l'API Messages, réduite à ce qu'on lit. */
export interface ReponseBrute {
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
  readonly stop_reason?: string | null;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

/**
 * Les cases relues d'une réponse. Une réponse qui n'est pas le JSON attendu ne rend RIEN :
 * une case sans relecture garde son jeton OCR, jamais une valeur devinée.
 */
export function lireLaReponse(reponse: ReponseBrute): CaseRelue[] {
  const texte = (reponse.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  try {
    const brut = JSON.parse(texte) as { cellules?: unknown };
    if (!Array.isArray(brut.cellules)) return [];
    return brut.cellules.flatMap((c: unknown) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return typeof x["id"] === "string" &&
        typeof x["texte"] === "string" &&
        typeof x["lisible"] === "boolean"
        ? [{ id: x["id"], texte: x["texte"], lisible: x["lisible"] }]
        : [];
    });
  } catch {
    return [];
  }
}

/* ================================================== LE CANDIDAT, LE PLAN === */

const ORIENTAUX: Readonly<Record<string, string>> = Object.fromEntries([
  ...[..."٠١٢٣٤٥٦٧٨٩"].map((c, i) => [c, String(i)]),
  ...[..."۰۱۲۳۴۵۶۷۸۹"].map((c, i) => [c, String(i)]),
]);

/**
 * Le candidat donné au moteur : chiffres orientaux en latins, « ، » et « ٫ » en virgule,
 * « ٬ » en espace. Le moteur relit ensuite ce texte comme celui de n'importe quel jeton.
 */
export function translitterer(texte: string): string {
  return [...texte]
    .map((c) => ORIENTAUX[c] ?? c)
    .join("")
    .replace(/[،٫]/gu, ",")
    .replace(/٬/gu, " ");
}

const MONTANT = new RegExp(
  `[${CHIFFRES}](?:[${CHIFFRES} ${echapper(SEPARATEURS)}]*[${CHIFFRES}])?`,
  "gu",
);

/**
 * La lecture réduite à son montant : la case relue peut porter un voisin (« % 2 245,018 »,
 * « 5.780,238 س », « 2 723,477 D »). Un seul nombre d'au moins deux chiffres, sinon rien :
 * deux nombres dans une case ne se départagent pas ici.
 */
export function leMontant(texte: string): string | null {
  const trouves = [...texte.matchAll(MONTANT)]
    .map((m) => m[0].trim())
    .filter((t) => translitterer(t).replace(/\D/gu, "").length >= 2);
  return trouves.length === 1 ? trouves[0]! : null;
}

/** Une case que la relecture a lue autrement que l'OCR. */
export interface Changement {
  readonly ordinal: number;
  readonly ocr: string;
  readonly relu: string;
  readonly candidat: string;
}

/**
 * Le plan candidat : chaque case relue LISIBLE, réduite à un seul montant et différente de
 * l'OCR, remplace le texte de son jeton. Rien d'autre ne change — ni la place, ni l'ordre,
 * ni les autres jetons.
 */
export function planCandidat(
  tokens: readonly PageToken[],
  cases: readonly CaseDecoupee[],
  relues: readonly CaseRelue[],
): { plan: PageToken[]; changements: Changement[] } {
  const parId = new Map(relues.map((r) => [r.id, r]));
  const parOrdinal = new Map<number, string>();
  const changements: Changement[] = [];
  for (const c of cases) {
    const r = parId.get(c.id);
    if (!r || !r.lisible || !r.texte.trim()) continue;
    const montant = leMontant(r.texte);
    if (montant === null) continue;
    const candidat = translitterer(montant);
    if (candidat.replace(/\s/gu, "") === c.jeton.text.replace(/\s/gu, "")) continue;
    parOrdinal.set(c.jeton.ordinal, candidat);
    changements.push({ ordinal: c.jeton.ordinal, ocr: c.jeton.text, relu: r.texte, candidat });
  }
  const plan = tokens.map((t) => {
    const candidat = t.page === 1 ? parOrdinal.get(t.ordinal) : undefined;
    return candidat === undefined ? { ...t } : { ...t, text: candidat };
  });
  return { plan, changements };
}

/* ============================================================== LE MOTIF === */

/** Où se trouve une case sur la page, en mots que l'écran traduit. */
export type Position = `${"haut" | "milieu" | "bas"}_${"gauche" | "centre" | "droite"}`;

export function positionDe(t: Pick<PageToken, "x0" | "x1" | "y0" | "y1">): Position {
  const y = (t.y0 + t.y1) / 2;
  const x = (t.x0 + t.x1) / 2;
  const v = y < 1 / 3 ? "haut" : y < 2 / 3 ? "milieu" : "bas";
  const hz = x < 1 / 3 ? "gauche" : x < 2 / 3 ? "centre" : "droite";
  return `${v}_${hz}`;
}

/**
 * Le libellé imprimé à gauche de la case, sur sa ligne (« Total TTC ») : le plus proche
 * jeton sans chiffre. Rien quand la ligne n'en porte pas — l'écran dit alors la position.
 */
export function libelleDeLaLigne(
  tokens: readonly PageToken[],
  kase: PageToken,
): string | null {
  const recouvre = (t: PageToken) =>
    t.page === kase.page &&
    Math.min(t.y1, kase.y1) - Math.max(t.y0, kase.y0) > 0.5 * Math.min(t.y1 - t.y0, kase.y1 - kase.y0);
  const voisins = tokens
    .filter((t) => t !== kase && recouvre(t) && t.x1 <= kase.x0 + 1e-6)
    .filter((t) => /\p{L}{2,}/u.test(t.text) && !/\d/u.test(t.text))
    .sort((a, b) => b.x1 - a.x1);
  const l = voisins[0]?.text.trim();
  return l ? l.slice(0, 60) : null;
}

/** Ce que la personne reçoit quand la relecture n'a pas prouvé la pièce. */
export interface MotifDeVerification {
  /**
   * `case_illisible` : le modèle n'a pas pu lire une case — la plus basse, la plus
   * probablement un total ; `ne_ferme_pas` : tout est lu, mais les montants ne ferment pas.
   */
  readonly code: "case_illisible" | "ne_ferme_pas";
  /** La case à vérifier : son texte OCR, son libellé, sa place. */
  readonly kase: {
    readonly texte: string;
    readonly libelle: string | null;
    readonly position: Position;
  } | null;
}

export function motifDeNonPreuve(
  tokens: readonly PageToken[],
  cases: readonly CaseDecoupee[],
  relues: readonly CaseRelue[],
): MotifDeVerification {
  const parId = new Map(relues.map((r) => [r.id, r]));
  const illisibles = cases
    .filter((c) => parId.get(c.id)?.lisible === false)
    .map((c) => c.jeton)
    .sort((a, b) => b.y1 - a.y1 || b.x1 - a.x1);
  const une = illisibles[0] ?? cases.map((c) => c.jeton).sort((a, b) => b.y1 - a.y1)[0];
  return {
    code: illisibles.length > 0 ? "case_illisible" : "ne_ferme_pas",
    kase: une
      ? { texte: une.text, libelle: libelleDeLaLigne(tokens, une), position: positionDe(une) }
      : null,
  };
}

/** Les lots d'une requête : `taille` cases par appel, les appels partent ensemble. */
export function enLots<T>(xs: readonly T[], taille: number): T[][] {
  const n = Math.max(1, taille);
  const lots: T[][] = [];
  for (let i = 0; i < xs.length; i += n) lots.push(xs.slice(i, i + n));
  return lots;
}
