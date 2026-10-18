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

import { callDeepSeek } from "../conseil/deepseek.ts";
import { repairArticles } from "./article-repair.ts";
import { extrairePagesScannees } from "./pdf-image.ts";
import { lireAvecPaddle, secondLecteurDisponible } from "./paddle.ts";
import { readPdfTextLayer } from "./pdf-text.ts";
import { BANDES_MAX, decouperEnBandes, fusionnerBandes } from "./bandes.ts";
import { lireAvecQwen, QwenError } from "./qwen.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";

/**
 * Deux organes, deux fournisseurs, une frontière nette.
 *
 * L'œil relève ce qui est écrit — couche de texte du PDF quand elle existe,
 * Qwen-VL-OCR sinon. Le raisonneur désigne, sans jamais voir la pièce : il ne
 * reçoit que le plan de tokens, et ne peut donc rien lire qui n'y figure pas.
 * C'est la garantie R2 rendue structurelle, et non plus seulement demandée.
 */
// Le nom vient de `../modeles.ts` : il était écrit une seconde fois ici.
import { MODELE_DESIGNATION, ROLE_DESIGNATION, modeleOcr } from "../modeles.ts";

/*
 * Les délais au-delà desquels un appel est tenu pour perdu. Sans eux, une
 * lecture dont le modèle ne répond pas restait « en cours » sans fin. Le
 * raisonneur est lent par nature — plusieurs minutes sur une facture
 * dense — d'où sa marge.
 */
const DELAI_RELEVE_MS = 120_000;
const DELAI_DESIGNATION_MS = 300_000;

function delaiDepasse(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

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
  // `null` est une RÉPONSE : « aucune des deux parties n'est le dossier ».
  // Aucune valeur par défaut — deviner « achat » classait des ventes.
  document_kind: z.enum(["facture_achat", "facture_vente"]).nullable().default(null),
  // Aucune devise par défaut : ce que la pièce n'imprime pas, le dossier le
  // dit. Un « TND » écrit ici lisait une facture en euros comme une facture en
  // dinars, et l'écart ne se voyait nulle part.
  currency: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().min(3).max(3).optional(),
  ),
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

interface VisionLine {
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

interface VisionCharge {
  code: string;
  amount: TokenRef | null;
}

export type VisionSelection = Omit<
  z.infer<typeof SelectionResponse>,
  "lines" | "articles" | "other_charges" | "currency"
> & {
  /** Toujours renseignée : celle de la pièce, sinon celle du dossier. */
  currency: string;
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
  /**
   * Le ROLE sous lequel la designation a ete appelee.
   *
   * Il voyage avec le modele, et c'est tout l'objet : `agents.model_pricing`
   * cherche un tarif par le COUPLE (modele, role). Le journal l'ecrivait en
   * dur — « reasoner » — pendant que l'appel passait par `ROLE_DESIGNATION`,
   * devenu « chat » le 5 octobre 2026. Aucun tarif pour ce couple : l'ecriture
   * du journal etait refusee, en silence, et plus AUCUNE designation n'a ete
   * mesuree depuis.
   *
   * Le deriver d'une seule source rend le desaccord impossible, plutot
   * qu'interdit — c'est deja la raison d'etre de `MODELE_DESIGNATION`.
   */
  selectRole: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Chaque passe séparément, pour le journal des exécutions (`agents.agent_runs`). */
  releve: { latencyMs: number; tokensIn: number | null; tokensOut: number | null };
  designation: { latencyMs: number; tokensIn: number | null; tokensOut: number | null };
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
/**
 * Le relevé et la lecture souple du JSON servent à TOUS les documents.
 *
 * La première passe — ce qui est écrit sur le papier, et où — ne dépend pas de
 * ce que le papier EST. Une facture et une carte d'identification fiscale
 * produisent le même plan de tokens ; seule la désignation qui suit diffère.
 * Les exporter évite d'écrire un second œil pour le second document.
 */
export function parseJsonLoose(raw: string): unknown {
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
      // Un délai dépassé n'est pas passager : le rejouer ferait attendre
      // deux fois. On le nomme, et l'écran le traduit.
      if (delaiDepasse(e)) throw new Error("lecture.trop_longue");
      const msg = e instanceof Error ? e.message : String(e);
      const transient =
        /\b(429|5\d\d)\b/.test(msg) || /Unrecognized token|illisible|JSON/i.test(msg);
      if (!transient || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  const message = `${label} : ${last instanceof Error ? last.message : String(last)}`;
  /*
   * LA CLASSE DE L'ERREUR SURVIT AU LABEL.
   *
   * Elle ne survivait pas : ce `throw` enveloppait tout dans un `new Error`,
   * ce qui détruisait `QwenError`. Or `estTronque` teste
   * `e instanceof QwenError` — il était donc TOUJOURS faux, et la boucle de
   * relecture en bandes de `lireUnePage` ne s'est jamais exécutée. Mesuré le
   * 18 octobre 2026 : une pièce dense a rendu « Qwen a tronqué le relevé » en
   * un seul appel, sans la moindre tentative en bandes.
   *
   * `bandes.ts` et son épreuve gardaient donc un chemin que rien n'atteignait
   * depuis sa création, et c'est l'explication de l'échec de `6ddc6804` le
   * 15 octobre : les bandes devaient le sauver et ne le pouvaient pas.
   */
  if (last instanceof QwenError)
    throw new QwenError(message, last.status, last.retryable, last.code);
  throw new Error(message);
}

export const SYSTEM_SELECT = `Tu es un désignateur. On te donne le plan de tokens déjà lu sur une facture.
Tu ne transcris JAMAIS une valeur : tu renvoies uniquement l'emplacement du token qui la porte,
sous la forme {"page":n,"ordinal":n}. Si un élément est absent de la pièce, renvoie null — ne
devine jamais.
Réponds STRICTEMENT en JSON :
{"document_kind":"facture_achat"|"facture_vente"|null,"currency":"<code ISO de la devise imprimée, ou null>",
 "issuer":{"page":1,"ordinal":3},"document_date":{"page":1,"ordinal":12},
 "lines":[{"label":"...","tax_code":"<un code de la liste fournie>",
           "base_ht":{...},"vat_amount":{...},"ttc":{...}}],
 "articles":[{"designation":{"page":1,"ordinal":40,"ordinal_end":43},"quantity":{...},
             "unit_price_ht":{...},"unit_price_ttc":{...},"total_ht":{...},"tax_code":"<code ou null>"}],
 "other_charges":[{"code":"<un code de droits fournis>","amount":{...}}],
 "totals":{"base_ht":{...},"vat":{...},"ttc":{...}},
 "references":{"matricule_fiscal":{...},"matricule_fiscal_client":{...},"numero":{...}},
 "overall_confidence":0.0}
LE SENS DE LA PIÈCE, À TRANCHER EN PREMIER : tout le reste en dépend.
On te donne le DOSSIER (raison sociale, matricule fiscal). Il est l'UNE des deux parties, jamais
les deux. L'ÉMETTEUR est la partie dont le nom et l'adresse OUVRENT le document, en haut : c'est
elle qui facture. Le CLIENT est l'autre, nommée ensuite, souvent introduite par « facturé à »,
« client », « doit », ou simplement posée sous l'émetteur.
 — le DOSSIER est le CLIENT   → "document_kind" vaut "facture_achat"
 — le DOSSIER est l'ÉMETTEUR  → "document_kind" vaut "facture_vente"
MATRICULES : ils DÉCOULENT du sens, ils ne se devinent pas séparément.
"references.matricule_fiscal" est celui de l'ÉMETTEUR de la pièce ;
"references.matricule_fiscal_client" est celui du CLIENT, s'il est imprimé — sinon null.
Donc, pour une "facture_achat", le matricule du DOSSIER va dans "matricule_fiscal_client", et
JAMAIS dans "matricule_fiscal" : celui-là porte le matricule du fournisseur.
Si NI l'émetteur NI le client n'est le dossier, ou si tu ne peux pas l'établir, renvoie null pour
"document_kind" : la personne tranchera. Ne déduis jamais le sens du seul vocabulaire
(« facture », « bon de livraison ») ni de la présence d'un tiers connu.
VÉRIFIE CECI AVANT DE RÉPONDRE : si "document_kind" vaut "facture_achat" et que
"matricule_fiscal" porte le matricule du DOSSIER, tu t'es trompé — intervertis-les.
PLAGES DE TOKENS. Le plan est découpé sur les ESPACES : une valeur peut donc occuper plusieurs
tokens contigus. Dans ce cas, et dans ce cas seulement, ajoute "ordinal_end" pour couvrir TOUS ses
tokens : {"page":1,"ordinal":3,"ordinal_end":5}. Cela vaut pour n'importe quel champ.
Les trois cas où c'est indispensable :
 — un MONTANT coupé par l'espace des milliers. « 2 800,000 » est DEUX tokens (« 2 » puis
   « 800,000 ») : désigne-les ensemble. Ne cite jamais « 2 » seul — ce serait rendre 2 dinars pour
   2 800 dinars. Même chose pour « 3 020,000 », « 1 234,560 », « 12 500 ». Ne cite jamais
   « 800,000 » seul non plus : la moitié qui reste a l'air d'un montant juste, et elle est fausse
   d'un facteur mille. Cette règle vaut TELLE QUELLE sur une pièce qui se lit de DROITE À GAUCHE :
   les chiffres, eux, s'y impriment de gauche à droite, donc « 5 650,000 » y est encore le token
   « 5 » SUIVI du token « 650,000 », et la plage va du premier au second.
 — une DATE en toutes lettres. « 1 septembre 2026 » est TROIS tokens : désigne-les ensemble.
 — un TEXTE en plusieurs mots : raison sociale, numéro en deux morceaux, désignation d'article.
Une valeur qui tient dans un seul token n'a pas de "ordinal_end" : « 220,000 » se cite seul.
La plage ne sert qu'à CITER plus large, jamais à assembler ce qui n'est pas contigu : les tokens
d'une plage doivent se suivre, et porter une seule valeur.
UNE PLAGE NE COUVRE JAMAIS DEUX MONTANTS. Beaucoup de factures répètent le même total côte à côte
(pied de colonne, puis récapitulatif) : « 514,700 514,700 » est DEUX montants, pas un montant en
deux tokens. Cite le premier seul. Le repère est la VIRGULE DÉCIMALE : si la plage que tu désignes
en contient deux, elle est trop large.
ARTICLES : une entrée par ligne du tableau des articles/prestations, dans l'ordre imprimé.
N'OMETS AUCUNE LIGNE du tableau, même sans prix unitaire, même sur plusieurs pages.
Méthode imposée : repère d'abord la ligne d'ENTÊTES du tableau (Désignation, Qté, P.U., P.U. TTC,
Total HT — ou leurs équivalents anglais/arabes), note l'ordinal de chaque entête, puis pour chaque
ligne du tableau prends les tokens de la MÊME bande horizontale, colonne par colonne, dans l'ordre
imprimé de gauche à droite (de droite à gauche si la pièce est en arabe).
La désignation est un champ TEXTUEL (utilise "ordinal_end" pour couvrir tous ses tokens, y compris
une désignation qui court sur deux lignes).
La quantité, les prix unitaires et les totaux de ligne suivent la règle des PLAGES ci-dessus :
un seul token quand la valeur en tient un, "ordinal_end" dès qu'une espace de milliers la coupe.
Ne confonds jamais la colonne du prix unitaire avec celle du total de ligne, ni le taux de TVA
(« 19 », « 19% ») avec un prix. Si une colonne n'est pas imprimée sur la pièce (pas de prix
unitaire TTC par exemple), renvoie null pour elle — ne la reconstitue jamais.
Un montant total de pied de facture n'est jamais une ligne d'article.
DROITS HORS TVA : si la pièce imprime un droit de timbre ou un droit assimilé, désigne le token
de son montant avec le code correspondant de la liste des droits fournie. Sinon, tableau vide.
Une ligne par taux de TVA présent sur la pièce. Le code de taux vient exclusivement de la liste
fournie ; s'il n'y a pas de correspondance, n'émets pas la ligne.
Le "ttc" d'une ligne ne se renseigne que si la pièce imprime un TTC PAR TAUX. Le total TTC du
pied de facture n'est le TTC d'aucune ligne : il porte aussi les droits hors TVA (timbre), qui
n'appartiennent à aucun taux. Il va dans "totals.ttc" et nulle part ailleurs — sinon renvoie null
pour le "ttc" de la ligne.`;

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
function estTronque(e: unknown): boolean {
  return e instanceof QwenError && e.code === "tronque";
}

/**
 * Lire UNE page : entière d'abord ; si l'œil la tronque, en deux bandes ;
 * si une bande est encore trop dense, en quatre. Au-delà, la page n'est pas
 * dense, elle est illisible — et on le dit.
 *
 * Chaque bande est un appel de modèle : on ne coupe que quand il le faut.
 * Le recollage (`fusionnerBandes`) est pur et éprouvé.
 */
async function lireUnePage(image: { dataUrl: string; page: number }): Promise<{
  tokens: PageToken[];
  tokensIn: number;
  tokensOut: number;
}> {
  const uneBande = (dataUrl: string) =>
    withRetry(`relevé page ${image.page}`, () =>
      lireAvecQwen({
        dataUrl,
        parseJson: parseJsonLoose,
        page: image.page,
        signal: AbortSignal.timeout(DELAI_RELEVE_MS),
      }),
    );

  try {
    const lu = await uneBande(image.dataUrl);
    return { tokens: lu.tokens, tokensIn: lu.tokensIn ?? 0, tokensOut: lu.tokensOut ?? 0 };
  } catch (e) {
    if (!estTronque(e)) throw e;
  }

  for (let nombre = 2; nombre <= BANDES_MAX; nombre *= 2) {
    const bandes = await decouperEnBandes(image.dataUrl, nombre);
    const lues: Array<{ bande: (typeof bandes)[number]; tokens: PageToken[] }> = [];
    let entree = 0;
    let sortie = 0;
    let tropDense = false;
    for (const bande of bandes) {
      try {
        const lu = await uneBande(bande.dataUrl);
        lues.push({ bande, tokens: lu.tokens });
        entree += lu.tokensIn ?? 0;
        sortie += lu.tokensOut ?? 0;
      } catch (e) {
        if (!estTronque(e)) throw e;
        tropDense = true;
        break;
      }
    }
    if (!tropDense) {
      return { tokens: fusionnerBandes(lues, image.page), tokensIn: entree, tokensOut: sortie };
    }
  }
  throw new Error("lecture.trop_dense");
}

/** Les octets d'une image rendue en `data:` — ce que le second lecteur attend. */
function octetsDuDataUrl(dataUrl: string): Uint8Array {
  const virgule = dataUrl.indexOf(",");
  return new Uint8Array(Buffer.from(dataUrl.slice(virgule + 1), "base64"));
}

/**
 * Relever des pages : PaddleOCR D'ABORD, le modèle de vision ensuite.
 *
 * ================================================================== POURQUOI
 *
 * 14 octobre 2026, à la demande du dirigeant. La mesure du 13 le soutient :
 * sur les treize pièces réelles, PaddleOCR trouve 20 montants que la chaîne
 * rate, et en rate 4 qu'elle trouve.
 *
 * Et ce n'est pas qu'une question de justesse. Le modèle de vision est un
 * appel payant, par page, avec une stratégie de bandes qui peut le rappeler
 * jusqu'à quatre fois quand il tronque. PaddleOCR ne coûte que du processeur,
 * et il est là, sur le réseau interne. Le mettre devant, c'est AUSSI l'ôter
 * du chemin courant.
 *
 * ================================================= CE QUI NE PASSE PAS DEVANT
 *
 * La couche de texte d'un PDF reste première, et ce n'est pas négociable : un
 * PDF émis par un logiciel porte son texte EXACT. Aucune reconnaissance
 * d'image, si bonne soit-elle, ne peut faire mieux que de recopier ce qui est
 * déjà écrit — elle peut seulement faire moins bien.
 *
 * ================================================== ET SI PADDLEOCR N'EST PAS LÀ
 *
 * `OCR_URL` absente, ou service muet : on retombe exactement sur la chaîne
 * d'avant. Ce n'est pas un repli silencieux, c'est le chemin nominal du jour
 * où le second lecteur n'est pas déployé.
 */
async function releverDesPages(
  pages: ReadonlyArray<{ dataUrl: string; page: number }>,
  sansPaddle: boolean,
): Promise<{
  tokens: PageToken[];
  source: string;
  tokensIn: number | null;
  tokensOut: number | null;
} | null> {
  if (sansPaddle || !secondLecteurDisponible()) return null;

  const tokens: PageToken[] = [];
  let modele = "paddleocr";
  for (const image of pages) {
    const lu = await lireAvecPaddle(octetsDuDataUrl(image.dataUrl), image.page);
    // Une seule page muette et on renonce : un plan de jetons incomplet
    // ferait désigner sur une pièce amputée, ce qui est pire que de la
    // relire entièrement avec l'autre lecteur.
    if (!lu || lu.tokens.length === 0) return null;
    tokens.push(...lu.tokens);
    modele = lu.modele;
  }
  return { tokens, source: modele, tokensIn: null, tokensOut: null };
}

export interface Releve {
  tokens: PageToken[];
  source: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface ParamsDeReleve {
  dataUrl: string;
  mime: string;
  bytes?: Uint8Array;
  /** Forcer le modèle de vision : c'est le rattrapage, dans l'autre sens. */
  sansPaddle?: boolean;
}

/**
 * Relever une pièce — et recoller ce que l'espace des milliers a coupé.
 *
 * ======================================== POURQUOI LE RECOLLAGE EST ICI
 *
 * `recollerLesMilliers` existe depuis le 5 octobre 2026, éprouvé par treize
 * cas, et **aucun code de production ne l'importait**. Son propre en-tête
 * annonce pourtant ce qu'il vient faire : « recoller ici rend la garantie
 * STRUCTURELLE — le montant n'est plus jamais coupé dans le plan, donc plus
 * jamais citable à moitié ». Il n'a jamais eu l'occasion de le faire.
 *
 * Le 18 octobre 2026, une facture arabe lue par la chaîne réelle est sortie
 * `extract.v1` VALIDE avec 650,000 D là où le papier porte 5 650,000 D : le
 * désignateur avait cité le second jeton de la paire sur les TROIS totaux à
 * la fois, et les trois équations ont confirmé la lecture. La consigne, elle,
 * n'interdisait plus la plage depuis le 5 octobre — c'est bien l'obéissance
 * du modèle qui a manqué, exactement le risque que ce module nommait.
 *
 * Il est posé au SEUL point par où tout plan de jetons passe, quel que soit
 * le lecteur : couche de texte d'un PDF, PaddleOCR, modèle de vision. Un
 * recollage branché sur un seul des trois chemins serait un recollage qu'on
 * croit avoir.
 */
export async function relever(params: ParamsDeReleve): Promise<Releve> {
  const brut = await releverSansRecollage(params);
  return { ...brut, tokens: recollerLesMilliers(brut.tokens) };
}

async function releverSansRecollage(params: ParamsDeReleve): Promise<Releve> {
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
      // Ni couche de texte, ni image extractible : un code, que l'écran
      // traduit dans la langue du dirigeant. La prose ne franchit pas la
      // frontière serveur → client autrement qu'en message nu.
      throw new Error("lecture.illisible");
    }

    // Le second lecteur passe DEVANT, quand il est là.
    const parPaddle = await releverDesPages(pages, params.sansPaddle ?? false);
    /*
     * LE NOM DU MODELE, SANS LE CHEMIN QUI L'A APPELE.
     *
     * 15 octobre 2026. Les relevés d'un PDF scanné ne se journalisaient pas —
     * ni ceux de PaddleOCR, ni ceux du modèle de vision, et depuis toujours.
     * La source portait un suffixe « +pdf-scan », et `agents.model_pricing`
     * cherche un tarif par le NOM DU MODELE : ce nom composite n'en désigne
     * aucun, l'écriture du journal était refusée, en silence.
     *
     * C'est le même défaut que celui du rôle écrit en dur, corrigé la veille :
     * une valeur composée là où le tarif attend une valeur simple. Le chemin
     * voyage donc à côté, et non dans le nom.
     */
    if (parPaddle) return parPaddle;

    const tokens: PageToken[] = [];
    let entree = 0;
    let sortie = 0;
    for (const image of pages) {
      // Le modèle ne voit qu'une image à la fois : la page réelle du PDF lui
      // est imposée, sinon deux pages porteraient les mêmes `page.ordinal` et
      // une citation désignerait deux tokens différents.
      const lu = await lireUnePage(image);
      tokens.push(...lu.tokens);
      entree += lu.tokensIn;
      sortie += lu.tokensOut;
    }
    return {
      tokens,
      source: modeleOcr(),
      tokensIn: entree || null,
      tokensOut: sortie || null,
    };
  }

  const parPaddle = await releverDesPages(
    [{ dataUrl: params.dataUrl, page: 1 }],
    params.sansPaddle ?? false,
  );
  if (parPaddle) return parPaddle;

  const lecture = await lireUnePage({ dataUrl: params.dataUrl, page: 1 });
  return {
    tokens: lecture.tokens,
    source: modeleOcr(),
    tokensIn: lecture.tokensIn || null,
    tokensOut: lecture.tokensOut || null,
  };
}

/**
 * La réponse du désignateur, convertie en sélection — le seul chemin.
 *
 * Sortie de `runVisionRead` le 5 octobre 2026 pour que l'épreuve de coût
 * (`tests/real/designation-cout.ts`) emprunte EXACTEMENT ce que la production
 * emprunte. Une épreuve qui recopierait cette conversion mesurerait sa propre
 * copie, et dériverait d'elle en silence — c'est ainsi qu'on obtient un banc
 * vert sur un produit faux.
 */
export function selectionDepuisReponse(
  reponse: unknown,
  devise: string,
  tokens: readonly PageToken[],
): VisionSelection {
  const raw = SelectionResponse.parse(reponse);
  return {
    ...raw,
    currency: raw.currency ?? devise,
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
}

export async function runVisionRead(params: {
  dataUrl: string;
  mime?: string;
  bytes?: Uint8Array;
  taxCodes: ReadonlyArray<{ code: string; label: string; rate: string }>;
  chargeCodes?: ReadonlyArray<{ code: string; label: string }>;
  /**
   * Les tiers déjà connus du dossier.
   *
   * Le raisonneur ne les invente pas : il DÉSIGNE. La liste l'aide à lire une
   * raison sociale que le relevé a pu abîmer — « REAM OPTI » pour « DREAM
   * OPTIC » — sans jamais se substituer à ce qui est imprimé : ce qu'il rend
   * reste un token du plan.
   *
   * Ce qu'elle NE fait PAS encore : rendre le tiers reconnu. Le contrat de
   * sortie n'a pas de champ pour cela, et en ajouter un touche la persistance,
   * le lettrage et la balance auxiliaire. C'est une fonctionnalité à part, pas
   * un effet de bord d'une invite.
   */
  tiers?: ReadonlyArray<{ code: string; raisonSociale: string; nature: string }>;
  /** Le dossier lui-même : ce qui décide du sens de la pièce. */
  dossier?: { raisonSociale: string; identifiantFiscal: string | null };
  /** La devise du dossier, retenue quand la pièce n'en imprime aucune. */
  devise: string;
  /**
   * Un plan de jetons DEJA releve, qui remplace la passe 1.
   *
   * C'est par la qu'entre le second lecteur : quand la premiere lecture sort
   * partielle, l'appelant releve a nouveau la page avec PaddleOCR et redemande
   * une designation sur CE plan-la. La passe 2 ne change pas d'un pouce — elle
   * ne voit toujours pas la piece, elle lit un plan et rend des page/ordinal.
   */
  tokens?: readonly PageToken[];
  /** Le nom du releveur, quand les jetons viennent d'ailleurs. Pour le journal. */
  releveur?: string;
  /** Forcer le modèle de vision, en écartant PaddleOCR : c'est le rattrapage. */
  sansPaddle?: boolean;
}): Promise<VisionRead> {
  const cleDeepSeek = process.env["DEEPSEEK_API_KEY"];
  if (!cleDeepSeek)
    throw new Error("DEEPSEEK_API_KEY absente : la pièce ne peut pas être désignée");
  const started = Date.now();

  // ---- Passe 1 : le relevé. Ce qui est écrit, rien de plus.
  //
  // Sauf si l'appelant en apporte un : c'est le rattrapage du second lecteur,
  // et on ne repaie pas un relevé qu'on vient de faire.
  const pass1 = params.tokens
    ? {
        tokens: params.tokens as PageToken[],
        source: params.releveur ?? "fourni",
        tokensIn: null,
        tokensOut: null,
      }
    : await relever({
        dataUrl: params.dataUrl,
        mime: params.mime ?? "image/jpeg",
        ...(params.bytes ? { bytes: params.bytes } : {}),
        sansPaddle: params.sansPaddle ?? false,
      });
  const tokens = pass1.tokens;
  const finReleve = Date.now();
  // L'œil a regardé, et n'a rien lu d'exploitable. Même contrat : un code.
  if (tokens.length === 0) throw new Error("lecture.vide");

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
  // Plafonné : une liste de tiers peut être longue, et l'invite a une fin. On
  // coupe explicitement plutôt que de laisser le modèle recevoir un texte
  // tronqué au hasard.
  const tiersText =
    (params.tiers ?? [])
      .slice(0, 300)
      .map((x) => `${x.code} — ${x.raisonSociale} (${x.nature})`)
      .join("\n") || "(aucun)";
  const pass2 = await withRetry("désignation", async () => {
    const res = await callDeepSeek({
      apiKey: cleDeepSeek,
      role: ROLE_DESIGNATION,
      signal: AbortSignal.timeout(DELAI_DESIGNATION_MS),
      messages: [
        { role: "system", content: SYSTEM_SELECT },
        {
          role: "user",
          content: `DOSSIER : ${params.dossier?.raisonSociale || "(inconnu)"} — matricule fiscal ${params.dossier?.identifiantFiscal || "(inconnu)"}.

Tiers déjà enregistrés pour ce dossier. Ils servent à RECONNAÎTRE une raison sociale que le relevé a pu abîmer — « REAM OPTI » pour « DREAM OPTIC ». Tu désignes toujours un token du plan, jamais une entrée de cette liste : elle aide à lire, elle ne remplace pas ce qui est imprimé.\n${tiersText}\n\nCodes de taux autorisés :\n${ratesText}\n\nCodes de droits hors TVA autorisés :\n${chargesText}\n\nPlan de tokens — une ligne par mot, colonnes séparées par une tabulation :\npage.ordinal\tx0,y0,x1,y1\ttexte\nLes coordonnées sont normalisées entre 0 et 1, l'origine en haut à gauche : deux mots de même y appartiennent à la même ligne imprimée, et x croît de gauche à droite.\n\n${planText}`,
        },
      ],
    });
    parseJsonLoose(res.answer);
    return res;
  });
  const selection = selectionDepuisReponse(parseJsonLoose(pass2.answer), params.devise, tokens);

  return {
    tokens,
    selection,
    // La lecture a deux auteurs : le journal doit nommer les deux, sinon un
    // coût ou une régression de qualité devient impossible à imputer.
    model: `${pass1.source}+${MODELE_DESIGNATION}`,
    readModel: pass1.source,
    selectModel: MODELE_DESIGNATION,
    selectRole: ROLE_DESIGNATION,
    latencyMs: Date.now() - started,
    tokensIn: (pass1.tokensIn ?? 0) + (pass2.tokensIn ?? 0) || null,
    tokensOut: (pass1.tokensOut ?? 0) + (pass2.tokensOut ?? 0) || null,
    releve: {
      latencyMs: finReleve - started,
      tokensIn: pass1.tokensIn ?? null,
      tokensOut: pass1.tokensOut ?? null,
    },
    designation: {
      latencyMs: Date.now() - finReleve,
      tokensIn: pass2.tokensIn ?? null,
      tokensOut: pass2.tokensOut ?? null,
    },
  };
}
