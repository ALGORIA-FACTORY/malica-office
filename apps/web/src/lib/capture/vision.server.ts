/**
 * L'œil — lecture en deux passes, jamais une transcription.
 *
 * Passe 1 : plan de tokens. Ce qui est écrit, token par token, avec sa boîte.
 *           Un PDF natif le fournit lui-même, sans modèle ; sinon l'œil le
 *           relève. C'est le seul moment où du texte entre dans le système,
 *           et il entre sans interprétation.
 * Passe 2 : désignation. Le modèle ne renvoie que des `page`/`ordinal` : il
 *           pointe les tokens qui portent l'émetteur, la date, les bases, les
 *           TVA, les totaux. Aucun montant ne traverse cette réponse.
 *
 * Les valeurs sont ensuite relues depuis le plan de tokens (`token-plan.ts`).
 * Toute désignation orpheline devient un drapeau, jamais une valeur.
 */

import { z } from "zod";

import { callDeepSeek } from "../regalica/deepseek.server";
import { repairArticles } from "./article-repair";
import { extrairePagesScannees } from "./pdf-image.server";
import { readPdfTextLayer } from "./pdf-text.server";
import { lireAvecQwen } from "./qwen.server";
import type { PageToken, TokenRef } from "./token-plan";

/**
 * Deux organes, deux fournisseurs, une frontière nette.
 *
 * L'œil relève ce qui est écrit — couche de texte du PDF quand elle existe,
 * Qwen-VL-OCR sinon. Le raisonneur désigne, sans jamais voir la pièce : il ne
 * reçoit que le plan de tokens, et ne peut donc rien lire qui n'y figure pas.
 * C'est la garantie R2 rendue structurelle, et non plus seulement demandée.
 */
const MODELE_DESIGNATION = "deepseek-reasoner";

const RefSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    ordinal: z.coerce.number().int().min(0),
    // Plage optionnelle pour un champ textuel étalé sur plusieurs tokens.
    ordinal_end: z.coerce.number().int().min(0).nullish(),
  })
  .nullable()
  .optional();

/**
 * Le modèle renvoie `null` — et non l'absence — quand la pièce ne porte pas
 * l'élément (un extrait de registre n'est pas une facture). Un `null` explicite
 * doit retomber sur la valeur par défaut, jamais faire échouer la lecture.
 */
const orDefault = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === null ? undefined : v), schema);

const SelectionResponse = z.object({
  document_kind: orDefault(z.enum(["facture_achat", "facture_vente"]).default("facture_achat")),
  currency: orDefault(z.string().min(3).max(3).default("TND")),
  issuer: RefSchema,
  document_date: RefSchema,
  lines: orDefault(
    z
      .array(
        z.object({
          // Le modèle désigne parfois le libellé par un token plutôt qu'en clair :
          // on accepte les deux, la valeur restant relue dans le plan de tokens.
          label: z
            .union([
              z.string(),
              z.object({
                page: z.coerce.number().int().min(1).default(1),
                ordinal: z.coerce.number().int().min(0),
              }),
            ])
            .nullish(),
          // Un taux non désigné rend la ligne inexploitable : elle est écartée,
          // jamais complétée par défaut.
          tax_code: z.string().min(1).nullish(),
          base_ht: RefSchema,
          vat_amount: RefSchema,
          ttc: RefSchema,
        }),
      )
      .default([]),
  ),
  articles: orDefault(
    z
      .array(
        z.object({
          designation: RefSchema,
          quantity: RefSchema,
          unit_price_ht: RefSchema,
          unit_price_ttc: RefSchema,
          total_ht: RefSchema,
          tax_code: z.string().min(1).nullish(),
        }),
      )
      .max(200)
      .default([]),
  ),
  other_charges: orDefault(
    z
      .array(z.object({ code: z.string().min(1), amount: RefSchema }))
      .max(20)
      .default([]),
  ),
  totals: orDefault(z.object({ base_ht: RefSchema, vat: RefSchema, ttc: RefSchema }).default({})),
  references: orDefault(z.record(z.string(), RefSchema).default({})),
  overall_confidence: orDefault(z.coerce.number().min(0).max(1).default(0.5)),
});

export interface VisionLine {
  label: string;
  tax_code: string;
  base_ht: TokenRef | null;
  vat_amount: TokenRef | null;
  ttc: TokenRef | null;
}

export interface VisionArticle {
  designation: TokenRef | null;
  quantity: TokenRef | null;
  unit_price_ht: TokenRef | null;
  unit_price_ttc: TokenRef | null;
  total_ht: TokenRef | null;
  tax_code: string | null;
}

export interface VisionCharge {
  code: string;
  amount: TokenRef | null;
}

export type VisionSelection = Omit<
  z.infer<typeof SelectionResponse>,
  "lines" | "articles" | "other_charges"
> & {
  lines: VisionLine[];
  articles: VisionArticle[];
  other_charges: VisionCharge[];
};

export interface VisionRead {
  tokens: PageToken[];
  selection: VisionSelection;
  /** Les deux organes réunis, pour l'affichage et le diagnostic. */
  model: string;
  /**
   * Chaque organe séparément : `agents_run_log` cherche un tarif par nom de
   * modèle, et la chaîne composite n'en désigne aucun. Une lecture se journalise
   * donc en deux exécutions — le relevé, puis la désignation — chacune avec ses
   * jetons et son prix. `pdf-text` est tarifé à zéro : lire un PDF natif ne
   * coûte rien, mais reste une lecture qui doit apparaître au journal.
   */
  readModel: string;
  selectModel: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** Le libellé de ligne est relu dans le plan quand le modèle l'a désigné. */
function labelText(
  v: string | { page: number; ordinal: number } | null | undefined,
  tokens: ReadonlyArray<PageToken>,
): string {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (v && typeof v === "object") {
    const tok = tokens.find((t) => t.page === v.page && t.ordinal === v.ordinal);
    if (tok) return tok.text;
  }
  return "Ligne";
}

/**
 * Une réponse tronquée par la limite de sortie du modèle n'est pas une valeur
 * inventée : on referme les tableaux/objets ouverts et on abandonne le dernier
 * élément incomplet. Aucun contenu n'est ajouté.
 */
function parseJsonLoose(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    // ignore, on tente la réparation
  }
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    if ((ch === "}" || ch === "]") && stack.length > 0) lastSafe = i;
  }
  if (lastSafe < 0) throw new Error("réponse du modèle illisible");
  let head = text.slice(0, lastSafe + 1);
  const open: string[] = [];
  inStr = false;
  esc = false;
  for (let i = 0; i < head.length; i += 1) {
    const ch = head[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") open.push("}");
    else if (ch === "[") open.push("]");
    else if (ch === "}" || ch === "]") open.pop();
  }
  head += open.reverse().join("");
  return JSON.parse(head);
}

function toRef(v: unknown): TokenRef | null {
  const r = v as
    { page?: number; ordinal?: number; ordinal_end?: number | null } | null | undefined;
  if (!r || typeof r.ordinal !== "number") return null;
  const ref: TokenRef = { page: r.page ?? 1, ordinal: r.ordinal };
  if (typeof r.ordinal_end === "number" && r.ordinal_end > r.ordinal)
    ref.ordinalEnd = r.ordinal_end;
  return ref;
}

/** Une passerelle qui répond 429/5xx ou du HTML est réessayée : jamais devinée. */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient =
        /\b(429|5\d\d)\b/.test(msg) || /Unrecognized token|illisible|JSON/i.test(msg);
      if (!transient || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`${label} : ${last instanceof Error ? last.message : String(last)}`);
}

const SYSTEM_SELECT = `Tu es un désignateur. On te donne le plan de tokens déjà lu sur une facture.
Tu ne transcris JAMAIS une valeur : tu renvoies uniquement l'emplacement du token qui la porte,
sous la forme {"page":n,"ordinal":n}. Si un élément est absent de la pièce, renvoie null — ne
devine jamais.
Réponds STRICTEMENT en JSON :
{"document_kind":"facture_achat"|"facture_vente","currency":"TND",
 "issuer":{"page":1,"ordinal":3},"document_date":{"page":1,"ordinal":12},
 "lines":[{"label":"...","tax_code":"<un code de la liste fournie>",
           "base_ht":{...},"vat_amount":{...},"ttc":{...}}],
 "articles":[{"designation":{"page":1,"ordinal":40,"ordinal_end":43},"quantity":{...},
             "unit_price_ht":{...},"unit_price_ttc":{...},"total_ht":{...},"tax_code":"<code ou null>"}],
 "other_charges":[{"code":"<un code de droits fournis>","amount":{...}}],
 "totals":{"base_ht":{...},"vat":{...},"ttc":{...}},
 "references":{"matricule_fiscal":{...},"numero":{...}},
 "overall_confidence":0.0}
Pour un champ TEXTUEL (issuer, references) dont la valeur occupe plusieurs tokens contigus
(raison sociale, numéro en deux morceaux), ajoute "ordinal_end" : {"page":1,"ordinal":3,"ordinal_end":5}.
Un MONTANT ou une DATE ne porte jamais "ordinal_end" : un seul token.
ARTICLES : une entrée par ligne du tableau des articles/prestations, dans l'ordre imprimé.
N'OMETS AUCUNE LIGNE du tableau, même sans prix unitaire, même sur plusieurs pages.
Méthode imposée : repère d'abord la ligne d'ENTÊTES du tableau (Désignation, Qté, P.U., P.U. TTC,
Total HT — ou leurs équivalents anglais/arabes), note l'ordinal de chaque entête, puis pour chaque
ligne du tableau prends les tokens de la MÊME bande horizontale, colonne par colonne, dans l'ordre
imprimé de gauche à droite (de droite à gauche si la pièce est en arabe).
La désignation est un champ TEXTUEL (utilise "ordinal_end" pour couvrir tous ses tokens, y compris
une désignation qui court sur deux lignes).
La quantité et les prix unitaires sont des MONTANTS : un seul token chacun, jamais "ordinal_end".
Ne confonds jamais la colonne du prix unitaire avec celle du total de ligne, ni le taux de TVA
(« 19 », « 19% ») avec un prix. Si une colonne n'est pas imprimée sur la pièce (pas de prix
unitaire TTC par exemple), renvoie null pour elle — ne la reconstitue jamais.
Un montant total de pied de facture n'est jamais une ligne d'article.
DROITS HORS TVA : si la pièce imprime un droit de timbre ou un droit assimilé, désigne le token
de son montant avec le code correspondant de la liste des droits fournie. Sinon, tableau vide.
Une ligne par taux de TVA présent sur la pièce. Le code de taux vient exclusivement de la liste
fournie ; s'il n'y a pas de correspondance, n'émets pas la ligne.`;

/**
 * Le relevé — trois chemins, un seul contrat de sortie.
 *
 * 1. PDF portant une couche de texte : il est lu tel quel, sans modèle et sans
 *    appel réseau. Rien ne peut être halluciné de ce qui est déjà écrit.
 * 2. PDF scanné : l'image de chaque page est extraite sans canvas, puis lue
 *    par l'œil. La page réelle est imposée aux tokens.
 * 3. Image : lue directement par l'œil.
 *
 * Quel que soit le chemin, il en sort un plan de tokens — du texte et sa
 * géométrie — et la suite ignore d'où il vient.
 */
async function relever(params: { dataUrl: string; mime: string; bytes?: Uint8Array }): Promise<{
  tokens: PageToken[];
  source: string;
  tokensIn: number | null;
  tokensOut: number | null;
}> {
  const estPdf = params.mime.toLowerCase().includes("pdf");

  // Un PDF émis par un logiciel porte déjà son texte et sa géométrie : aucun
  // modèle n'a à le relire, donc aucun modèle ne peut s'y tromper.
  if (estPdf && params.bytes) {
    const couche = await readPdfTextLayer(params.bytes);
    if (couche.exploitable) {
      return { tokens: couche.tokens, source: "pdf-text", tokensIn: null, tokensOut: null };
    }
    // Sinon la pièce est un scan déguisé en PDF : pas de texte, des pixels.
    // On extrait l'image de chaque page — sans canvas — et l'œil la lit.
    const pages = await extrairePagesScannees(params.bytes);
    if (pages.length === 0) {
      throw new Error("PDF sans couche de texte ni image exploitable : pièce illisible");
    }

    const tokens: PageToken[] = [];
    let entree = 0;
    let sortie = 0;
    for (const image of pages) {
      // Le modèle ne voit qu'une image à la fois : la page réelle du PDF lui
      // est imposée, sinon deux pages porteraient les mêmes `page.ordinal` et
      // une citation désignerait deux tokens différents.
      const lu = await withRetry(`relevé page ${image.page}`, () =>
        lireAvecQwen({ dataUrl: image.dataUrl, parseJson: parseJsonLoose, page: image.page }),
      );
      tokens.push(...lu.tokens);
      entree += lu.tokensIn ?? 0;
      sortie += lu.tokensOut ?? 0;
    }
    return {
      tokens,
      source: `${process.env["QWEN_OCR_MODEL"] ?? "qwen"}+pdf-scan`,
      tokensIn: entree || null,
      tokensOut: sortie || null,
    };
  }

  const lecture = await withRetry("plan de tokens", () =>
    lireAvecQwen({ dataUrl: params.dataUrl, parseJson: parseJsonLoose }),
  );
  return {
    tokens: lecture.tokens,
    source: lecture.model,
    tokensIn: lecture.tokensIn,
    tokensOut: lecture.tokensOut,
  };
}

export async function runVisionRead(params: {
  dataUrl: string;
  mime?: string;
  bytes?: Uint8Array;
  taxCodes: ReadonlyArray<{ code: string; label: string; rate: string }>;
  chargeCodes?: ReadonlyArray<{ code: string; label: string }>;
}): Promise<VisionRead> {
  const cleDeepSeek = process.env["DEEPSEEK_API_KEY"];
  if (!cleDeepSeek)
    throw new Error("DEEPSEEK_API_KEY absente : la pièce ne peut pas être désignée");
  const started = Date.now();

  // ---- Passe 1 : le relevé. Ce qui est écrit, rien de plus.
  const pass1 = await relever({
    dataUrl: params.dataUrl,
    mime: params.mime ?? "image/jpeg",
    ...(params.bytes ? { bytes: params.bytes } : {}),
  });
  const tokens = pass1.tokens;
  if (tokens.length === 0) throw new Error("aucun token lisible sur la pièce");

  // ---- Passe 2 : désignation, sans aucune valeur.
  // Le désignateur ne voit pas la pièce : la géométrie voyage donc dans le plan.
  // Sans elle, « la même bande horizontale » ne veut plus rien dire et les
  // colonnes du tableau d'articles deviennent indevinables.
  const planText = tokens
    .map(
      (t) =>
        `${t.page}.${t.ordinal}\t${t.x0.toFixed(3)},${t.y0.toFixed(3)},${t.x1.toFixed(3)},${t.y1.toFixed(3)}\t${t.text}`,
    )
    .join("\n")
    .slice(0, 60_000);
  const ratesText = params.taxCodes.map((r) => `${r.code} — ${r.label} (${r.rate})`).join("\n");
  const chargesText =
    (params.chargeCodes ?? []).map((c) => `${c.code} — ${c.label}`).join("\n") || "(aucun)";
  const pass2 = await withRetry("désignation", async () => {
    const res = await callDeepSeek({
      apiKey: cleDeepSeek,
      role: "reasoner",
      messages: [
        { role: "system", content: SYSTEM_SELECT },
        {
          role: "user",
          content: `Codes de taux autorisés :\n${ratesText}\n\nCodes de droits hors TVA autorisés :\n${chargesText}\n\nPlan de tokens — une ligne par mot, colonnes séparées par une tabulation :\npage.ordinal\tx0,y0,x1,y1\ttexte\nLes coordonnées sont normalisées entre 0 et 1, l'origine en haut à gauche : deux mots de même y appartiennent à la même ligne imprimée, et x croît de gauche à droite.\n\n${planText}`,
        },
      ],
    });
    parseJsonLoose(res.answer);
    return res;
  });
  const raw = SelectionResponse.parse(parseJsonLoose(pass2.answer));

  const selection: VisionSelection = {
    ...raw,
    issuer: toRef(raw.issuer),
    document_date: toRef(raw.document_date),
    lines: raw.lines
      .filter((l): l is typeof l & { tax_code: string } => Boolean(l.tax_code))
      .map((l) => ({
        ...l,
        label: labelText(l.label, tokens),
        base_ht: toRef(l.base_ht),
        vat_amount: toRef(l.vat_amount),
        ttc: toRef(l.ttc),
      })),
    // Colonnes manquantes complétées par géométrie, jamais par le modèle :
    // le token désigné existe déjà dans le plan.
    articles: repairArticles(
      tokens,
      raw.articles.map((a) => ({
        designation: toRef(a.designation),
        quantity: toRef(a.quantity),
        unit_price_ht: toRef(a.unit_price_ht),
        unit_price_ttc: toRef(a.unit_price_ttc),
        total_ht: toRef(a.total_ht),
        tax_code: a.tax_code ?? null,
      })),
    ),
    other_charges: raw.other_charges.map((c) => ({ code: c.code, amount: toRef(c.amount) })),
    totals: {
      base_ht: toRef(raw.totals.base_ht),
      vat: toRef(raw.totals.vat),
      ttc: toRef(raw.totals.ttc),
    },
    references: Object.fromEntries(Object.entries(raw.references).map(([k, v]) => [k, toRef(v)])),
  };

  return {
    tokens,
    selection,
    // La lecture a deux auteurs : le journal doit nommer les deux, sinon un
    // coût ou une régression de qualité devient impossible à imputer.
    model: `${pass1.source}+${MODELE_DESIGNATION}`,
    readModel: pass1.source,
    selectModel: MODELE_DESIGNATION,
    latencyMs: Date.now() - started,
    tokensIn: (pass1.tokensIn ?? 0) + (pass2.tokensIn ?? 0) || null,
    tokensOut: (pass1.tokensOut ?? 0) + (pass2.tokensOut ?? 0) || null,
  };
}
