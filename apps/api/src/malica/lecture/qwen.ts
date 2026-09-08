/**
 * L'œil — Qwen-VL-OCR, modèle dédié, et rien d'autre.
 *
 * Ce module ne fait qu'une chose : rendre le texte écrit sur une image, avec la
 * position de chaque mot. Il ne désigne rien, ne classe rien, ne calcule rien.
 * La désignation appartient au raisonneur, la valeur au Socle.
 *
 * Pourquoi l'endpoint DashScope NATIF et non le mode compatible OpenAI :
 * les tâches intégrées d'OCR (`ocr_options`) n'existent que là. Or c'est
 * `advanced_recognition` qui produit la géométrie, et un modèle OCR interrogé
 * par prompt libre n'en produit aucune — vérifié contre l'API. Sans géométrie,
 * la passe 2, qui ne voit pas la pièce, ne peut plus distinguer les colonnes
 * d'un tableau d'articles.
 *
 * L'hôte n'est pas codé en dur : Model Studio expose des domaines différents
 * selon la région (Singapour, Pékin, Virginie). Une valeur devinée enverrait
 * les pièces d'un client au mauvais endroit : on exige donc `QWEN_BASE_URL`.
 */

import type { PageToken } from "./token-plan.ts";

/** Qwen situe ses boîtes dans un repère normalisé 0..999. */
const REPERE_QWEN = 1000;

/** Chemin de l'API native, seule à exposer les tâches OCR intégrées. */
const CHEMIN_NATIF = "/api/v1/services/aigc/multimodal-generation/generation";

export interface QwenLecture {
  tokens: PageToken[];
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export class QwenError extends Error {
  // Champs déclarés puis affectés : Node décape les types sans compiler, et
  // une propriété de paramètre est la seule syntaxe qu'il ne sait pas effacer.
  readonly status: number;
  readonly retryable: boolean;
  /** Ce que l'appelant peut faire : « tronque » se relit en bandes. */
  readonly code: "tronque" | null;
  constructor(message: string, status: number, retryable: boolean, code: "tronque" | null = null) {
    super(message);
    this.name = "QwenError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

interface QwenConfig {
  url: string;
  apiKey: string;
  model: string;
}

function config(): QwenConfig {
  const base = process.env["QWEN_BASE_URL"];
  const apiKey = process.env["QWEN_API_KEY"];
  if (!apiKey) {
    throw new QwenError("QWEN_API_KEY absente : la pièce ne peut pas être lue", 401, false);
  }
  if (!base) {
    throw new QwenError(
      "QWEN_BASE_URL absente : l'hôte Model Studio dépend de votre région",
      500,
      false,
    );
  }
  // On accepte aussi bien l'origine seule qu'une URL de mode compatible :
  // seule l'origine compte, le chemin natif est imposé par ce module.
  const origine = base.replace(/\/+$/, "").replace(/\/compatible-mode(\/v\d+)?$/, "");
  return {
    url: `${origine}${CHEMIN_NATIF}`,
    apiKey,
    /**
     * Millésime figé, jamais `-latest` : une mise à jour silencieuse du modèle
     * changerait le relevé sans qu'aucune ligne de code ne bouge, et une pièce
     * relue ne donnerait plus la même chose qu'à sa comptabilisation.
     */
    model: process.env["QWEN_OCR_MODEL"] ?? "qwen-vl-ocr-2025-11-20",
  };
}

/** Un segment rendu par `advanced_recognition` : du texte et son rectangle. */
interface Segment {
  text: string;
  /** [cx, cy, largeur, hauteur, angle°] dans le repère 0..999. */
  rotate_rect?: unknown;
  location?: unknown;
}

interface Boite {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Le rectangle de Qwen porte un angle : une pièce photographiée de travers a
 * ses lignes inclinées. On rend la boîte alignée sur les axes qui l'englobe —
 * c'est ce dont la passe 2 a besoin pour raisonner en lignes et en colonnes.
 */
function boiteDe(rect: number[]): Boite | null {
  const [cx, cy, w, h, angle] = rect as [number, number, number, number, number];
  if (![cx, cy, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;

  const rad = ((angle ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const largeur = w * cos + h * sin;
  const hauteur = w * sin + h * cos;

  return {
    x0: (cx - largeur / 2) / REPERE_QWEN,
    y0: (cy - hauteur / 2) / REPERE_QWEN,
    x1: (cx + largeur / 2) / REPERE_QWEN,
    y1: (cy + hauteur / 2) / REPERE_QWEN,
  };
}

/**
 * Les écritures qui se lisent de droite à gauche — l'arabe, ici, qui est l'une
 * des trois langues de Malica Office. Plages en échappements : écrites en
 * caractères littéraux, elles embarquent des espaces de largeur nulle.
 */
const RTL =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

/**
 * Un segment couvre une cellule, pas un mot : « Monture acetate » arrive d'un
 * bloc. Le plan de tokens raisonne en mots, on redécoupe donc, en répartissant
 * la largeur du segment au prorata des caractères.
 *
 * L'approximation est assumée et sans conséquence : à l'intérieur d'une cellule
 * il n'y a pas de grand blanc, et cette largeur ne sert qu'à situer le mot dans
 * sa colonne — jamais à produire une valeur. Le texte, lui, est exact.
 *
 * En écriture arabe, le premier mot logique est le plus à droite : la largeur
 * s'alloue depuis la droite, sans quoi une désignation pointerait à l'opposé.
 */
function decouperEnMots(segment: string, boite: Boite, page: number, depuis: number): PageToken[] {
  const texte = segment.trim();
  if (texte.length === 0) return [];

  const total = texte.length;
  const largeur = boite.x1 - boite.x0;
  const droiteAGauche = RTL.test(texte);
  const sortie: PageToken[] = [];
  let ordinal = depuis;

  for (const m of texte.matchAll(/\S+/g)) {
    const debut = m.index ?? 0;
    const part = largeur / total;
    const x0 = droiteAGauche ? boite.x1 - part * (debut + m[0].length) : boite.x0 + part * debut;

    sortie.push({
      page,
      ordinal,
      text: m[0],
      x0: Math.max(0, Math.min(1, x0)),
      y0: Math.max(0, Math.min(1, boite.y0)),
      x1: Math.max(0, Math.min(1, x0 + part * m[0].length)),
      y1: Math.max(0, Math.min(1, boite.y1)),
    });
    ordinal += 1;
  }
  return sortie;
}

/**
 * L'ordre des segments rendu par le modèle est l'ordre de lecture — il a été
 * vérifié correct sur une pièce en arabe. On le conserve : le renuméroter par
 * coordonnées casserait précisément les écritures de droite à gauche.
 */
function versPlan(brut: unknown, page: number): PageToken[] {
  const segments = Array.isArray(brut) ? (brut as Segment[]) : [];
  const sortie: PageToken[] = [];

  for (const s of segments) {
    if (typeof s?.text !== "string") continue;
    const rect = s.rotate_rect ?? s.location;
    if (!Array.isArray(rect) || rect.length < 4) continue;
    const boite = boiteDe(rect as number[]);
    if (!boite) continue;
    sortie.push(...decouperEnMots(s.text, boite, page, sortie.length));
  }
  return sortie;
}

export async function lireAvecQwen(input: {
  dataUrl: string;
  parseJson: (texte: string) => unknown;
  page?: number;
  signal?: AbortSignal;
}): Promise<QwenLecture> {
  const { url, apiKey, model } = config();

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: {
        messages: [
          {
            role: "user",
            content: [{ image: input.dataUrl }, { text: "Relève tout le texte et sa position." }],
          },
        ],
      },
      parameters: {
        // La tâche intégrée qui rend le texte AVEC sa géométrie. Sans elle, le
        // modèle ne renvoie qu'une transcription à plat, inutilisable ici.
        ocr_options: { task: "advanced_recognition" },
        /*
         * ============================================ LE PLAFOND DE SORTIE
         *
         * Il n'était pas fixé, donc DashScope appliquait le sien — bas. Une
         * facture de fournisseur avec son tableau d'articles le dépassait, la
         * réponse était coupée en plein relevé, et la lecture échouait :
         *
         *   « Qwen a tronqué le relevé (plafond de jetons atteint) »
         *
         * C'est le message qui est remonté du téléphone. Le relevé de position
         * est verbeux par nature — chaque mot vient avec son rectangle —, et
         * une pièce dense en produit beaucoup.
         *
         * Le garde-fou plus bas reste : un relevé tronqué produit des ordinaux
         * qui ne désignent plus rien, et mieux vaut échouer que livrer un plan
         * de tokens amputé sur lequel des montants seraient cités de travers.
         * Ce plafond ne le remplace pas, il le rend rare.
         */
        max_tokens: 8192,
      },
    }),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new QwenError(
      `Qwen ${res.status} : ${txt.slice(0, 200)}`,
      res.status,
      res.status === 429 || res.status >= 500,
    );
  }

  const json = (await res.json()) as {
    output?: {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: Array<{ text?: string; ocr_result?: { processed_text?: string } }> };
      }>;
    };
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const choix = json.output?.choices?.[0];
  if (choix?.finish_reason === "length") {
    // Un relevé tronqué produit des ordinaux qui ne désignent plus rien : mieux
    // vaut échouer que livrer un plan de tokens amputé.
    throw new QwenError(
      "Qwen a tronqué le relevé (plafond de jetons atteint)",
      502,
      false,
      "tronque",
    );
  }

  const bloc = choix?.message?.content?.[0];
  const contenu = bloc?.ocr_result?.processed_text ?? bloc?.text ?? "";
  if (contenu.trim().length === 0) throw new QwenError("relevé Qwen vide", 502, true);

  const tokens = versPlan(input.parseJson(contenu), input.page ?? 1);
  if (tokens.length === 0) throw new QwenError("aucun mot situé sur la pièce", 502, true);

  return {
    tokens,
    model,
    tokensIn: json.usage?.input_tokens ?? null,
    tokensOut: json.usage?.output_tokens ?? null,
  };
}
