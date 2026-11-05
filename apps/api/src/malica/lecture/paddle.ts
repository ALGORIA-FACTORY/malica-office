/**
 * Le second lecteur : PaddleOCR, appelé en rattrapage.
 *
 * ================================================================== POURQUOI
 *
 * 13 octobre 2026. Sur une facture réelle, « 4 135,183 » imprimé en blanc sur
 * bande noire est reconnu « + 135,183 » : le 4 devient un +. Le total recollé
 * ne se lit plus, et aucune écriture ne se propose.
 *
 * Mesuré le même jour sur les treize pièces du staging : PaddleOCR trouve 20
 * montants que la chaîne actuelle rate, et en rate 4 qu'elle trouve — dont
 * deux vraies pertes sur une facture de câblerie. Cinq contre un.
 *
 * ========================================================== D'OÙ LE RÔLE
 *
 * Renfort, jamais remplacement, et pour trois raisons dans cet ordre :
 *
 *   — un PDF qui porte son texte se lit EXACTEMENT ; remplacer cet exact par
 *     de la reconnaissance d'image serait un recul, quel que soit le lecteur ;
 *   — il perd des montants sur certaines pièces : basculer entièrement
 *     échangerait un défaut connu contre un défaut inconnu ;
 *   — appelé seulement là où la première lecture a échoué, son coût en temps
 *     ne pèse que sur les pièces qui, autrement, ne donnent rien.
 *
 * ================================================= CE QU'IL FAIT, ET RIEN DE PLUS
 *
 * Il rend du texte et des positions. Décider lequel de ces nombres est le
 * total reste le travail de la désignation, et R2 ne bouge pas d'un pouce : le
 * modèle qui désigne ne voit toujours pas la pièce, il reçoit un plan de
 * jetons et rend des `page`/`ordinal`.
 *
 * ====================================================== QUAND IL N'EST PAS LÀ
 *
 * `OCR_URL` absente, le second lecteur n'existe pas et la chaîne se comporte
 * exactement comme avant. C'est délibéré : le jour où le service tombe, une
 * lecture partielle reste une lecture partielle — jamais une panne.
 */
import type { MarqueDeLaPage, PageToken } from "@malica/socle/ports/malica";

import { PanneFournisseur } from "../../fabrique/travaux-execution.ts";

import { decouperEnMots } from "./mots.ts";
import type { LectureDeCellule } from "./relecture.ts";

/** Ce que le service rend. Le contrat tient en trois champs. */
interface LignePaddle {
  texte: string;
  /** [x0, y0, x1, y1], NORMALISÉS de 0 à 1 dans la page. */
  boite: [number, number, number, number];
  confiance: number | null;
  /** La probabilité de chaque caractère du texte, quand le service la donne. */
  caracteres?: number[];
  /** Après chaque caractère, la probabilité d'une lettre non émise (`manque`). */
  manques?: number[];
}

export interface ReleveDuSecondLecteur {
  tokens: PageToken[];
  /** Les marques de la page (les cachets), vues sans modèle. */
  marques: MarqueDeLaPage[];
  modele: string;
  millisecondes: number;
}

/** Le délai au-delà duquel on renonce : un rattrapage qui s'éternise n'en est plus un. */
const DELAI_MS = 120_000;

/** Le second lecteur est-il branché ? Son absence n'est pas une panne. */
export function secondLecteurDisponible(): boolean {
  return Boolean(process.env["OCR_URL"]) && Date.now() >= enPanneJusqua;
}

/*
 * ===================================================== LE COUPE-CIRCUIT
 *
 * Audit du 24 octobre 2026 : PaddleOCR tombé (mémoire épuisée, conteneur
 * arrêté) rendait TOUTES les photos illisibles — chaque lecture levait sa
 * panne, la file la rejouait trois fois, puis abandonnait au bout de quinze
 * minutes. Le modèle de vision était là, et personne ne lui passait la main.
 *
 * Désormais une panne de PaddleOCR fait basculer la pièce sur le modèle de
 * vision (voir `releverDesPages`), et ouvre ce coupe-circuit : pendant
 * `COUPE_CIRCUIT_MS`, PaddleOCR n'est plus essayé du tout. Sans lui, chaque
 * pièce suivante attendrait d'abord le délai de PaddleOCR avant de basculer —
 * deux minutes par page, pour rien. Passé ce délai, il est réessayé : un
 * service redémarré reprend sa place sans que personne n'ait à intervenir.
 *
 * C'est un réglage technique d'exploitation, pas une règle métier (R4).
 */
const COUPE_CIRCUIT_MS = 60_000;
let enPanneJusqua = 0;

/** Écarter PaddleOCR un moment : il vient de tomber. */
export function ouvrirLeCoupeCircuit(maintenant: number = Date.now()): void {
  enPanneJusqua = maintenant + COUPE_CIRCUIT_MS;
}

/** Pour les épreuves : le service est réputé revenu. */
export function refermerLeCoupeCircuit(): void {
  enPanneJusqua = 0;
}

/**
 * Relever une page avec PaddleOCR.
 *
 * ================================== ABSENT ET TOMBÉ NE SONT PAS LA MÊME CHOSE
 *
 * `OCR_URL` absente : le second lecteur n'existe pas, on rend `null`, et la
 * chaîne se comporte exactement comme avant. Service présent et MUET (aucune
 * ligne reconnue) : `null` aussi — la pièce est illisible pour lui, pas en
 * panne.
 *
 * Service CONFIGURÉ mais injoignable, en erreur, ou trop lent : c'est une
 * PANNE DE FOURNISSEUR, et depuis le 14 octobre ce lecteur est passé DEVANT.
 * Rendre `null` y avait deux conséquences, mesurables toutes les deux :
 *
 *   — la lecture repartait sur le modèle de vision, donc une panne de notre
 *     propre machine se payait en appels distants, sans que rien ne le dise ;
 *   — au rattrapage, la chaîne rappelait le modèle de vision une SECONDE
 *     fois, alors que son commentaire promet « on ne relit pas deux fois avec
 *     le même ».
 *
 * La classe est celle que la file durable sait rejouer. Elle ne change rien
 * quand le service est absent : c'est le cas nominal du jour où il n'est pas
 * déployé, et il reste nominal.
 */
/**
 * Le service dit `{"occupe": true}` quand il lit déjà une pièce et que l'attente
 * dépasse `OCR_ATTENTE_MAX_S` (`infra/ocr/service.py`). Il est VIVANT : seule CETTE
 * pièce bascule sur l'autre lecteur ; le coupe-circuit, lui, reste fermé —
 * sinon une rafale de captures enverrait toutes les suivantes, pendant une
 * minute, sur le modèle payant. Sans autre lecteur, c'est une panne comme une
 * autre : la file durable la rejoue.
 */
export class SecondLecteurOccupe extends PanneFournisseur {
  constructor() {
    super("second lecteur occupé");
  }
}

/**
 * Le moteur que le second lecteur annonce (`/sante` du service : « onnx » ou
 * « paddle »), pour la sonde de santé de l'API : on doit pouvoir dire lequel
 * tourne sans entrer dans le conteneur (staging, 1er novembre 2026). Rien de
 * plus ne sort — ni modèle, ni empreinte. `absent` sans `OCR_URL` ; `hs` s'il
 * ne répond pas en deux secondes : la santé de l'API n'en dépend pas.
 */
export async function moteurDuSecondLecteur(): Promise<string> {
  if (!process.env["OCR_URL"]) return "absent";
  const corps = await santeDuSecondLecteur();
  if (!corps) return "hs";
  return typeof corps.moteur === "string" && /^[a-z]{1,20}$/.test(corps.moteur)
    ? corps.moteur
    : "inconnu";
}

/**
 * Les lectures que le second lecteur mène en même temps (`lecteurs` sur
 * `/sante`, `OCR_LECTEURS` du service) : les pages d'une pièce se lisent
 * autant à la fois. Un, s'il ne le dit pas.
 */
export async function lecteursDuSecondLecteur(): Promise<number> {
  const n = (await santeDuSecondLecteur())?.lecteurs;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : 1;
}

/** `/sante` du service, en deux secondes au plus ; `null` s'il ne répond pas. */
async function santeDuSecondLecteur(): Promise<{ moteur?: unknown; lecteurs?: unknown } | null> {
  const base = process.env["OCR_URL"];
  if (!base) return null;
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/sante`, {
      signal: AbortSignal.timeout(2_000),
    });
    return r.ok ? ((await r.json()) as { moteur?: unknown; lecteurs?: unknown }) : null;
  } catch {
    return null;
  }
}

/**
 * ============================================ DEUX TEMPS, UNE SEULE LECTURE
 *
 * Le service rend chaque page en deux temps, une ligne JSON chacun : le TABLEAU
 * d'abord (ses rangées et les boîtes courtes, lus en premier), puis la page
 * entière — la lecture complète, celle qui est rendue. `surLeTableau` reçoit les
 * jetons du premier temps dès qu'ils arrivent : de quoi prouver les totaux et
 * les articles pendant que le reste de la page se lit. Rien n'est sauté : le
 * second temps reste la seule lecture qui compte.
 */
export async function lireAvecPaddle(
  image: Uint8Array,
  page: number,
  signal?: AbortSignal,
  surLeTableau?: (tokens: PageToken[]) => void,
): Promise<ReleveDuSecondLecteur | null> {
  const base = process.env["OCR_URL"];
  if (!base) return null;

  const minuteur = AbortSignal.timeout(DELAI_MS);
  const arret = signal ? AbortSignal.any([signal, minuteur]) : minuteur;

  // Service éteint, réseau coupé, délai dépassé, flux interrompu — et `OCR_URL`
  // est bien posée : quelqu'un a déployé ce lecteur et il ne répond pas.
  const injoignable = (e: unknown) =>
    new PanneFournisseur(
      `second lecteur injoignable : ${e instanceof Error ? e.message : String(e)}`,
    );
  let reponse: Response;
  try {
    reponse = await fetch(`${base.replace(/\/+$/, "")}/lire`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      // Les octets bruts : `fetch` accepte un tableau typé tel quel.
      body: image,
      signal: arret,
    });
  } catch (e) {
    throw injoignable(e);
  }
  if (!reponse.ok || !reponse.body) {
    throw new PanneFournisseur(`second lecteur : ${String(reponse.status)}`);
  }

  let complete: TempsDeLecture | null = null;
  try {
    for await (const temps of tempsDeLecture(reponse.body)) {
      if (temps.occupe) throw new SecondLecteurOccupe();
      if (temps.vague === 1) surLeTableau?.(jetonsDesLignes(temps.lignes ?? [], page));
      else complete = temps;
    }
  } catch (e) {
    throw e instanceof PanneFournisseur ? e : injoignable(e);
  }
  if (!complete) throw new PanneFournisseur("second lecteur : lecture interrompue");

  const lignes = complete.lignes ?? [];
  if (lignes.length === 0) return null;
  return {
    tokens: jetonsDesLignes(lignes, page),
    marques: (complete.marques ?? []).map((m) => ({
      page,
      type: m.type,
      x0: m.boite[0],
      y0: m.boite[1],
      x1: m.boite[2],
      y1: m.boite[3],
    })),
    modele: complete.modele ?? "paddleocr",
    millisecondes: complete.millisecondes ?? 0,
  };
}

/**
 * Relire des cellules, chacune SEULE dans sa boîte (`POST /relire`) : la relecture guidée
 * par la contradiction (`relecture.ts`). `null` quand le service n'est pas branché.
 */
export async function relireDesCellules(
  image: Uint8Array,
  boites: readonly (readonly [number, number, number, number])[],
): Promise<LectureDeCellule[] | null> {
  const base = process.env["OCR_URL"];
  if (!base || boites.length === 0) return null;
  const reponse = await fetch(`${base.replace(/\/+$/, "")}/relire`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: Buffer.from(image).toString("base64"), boites }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!reponse.ok) throw new PanneFournisseur(`second lecteur : ${String(reponse.status)}`);
  const corps = (await reponse.json()) as { occupe?: boolean; lectures?: LectureDeCellule[] };
  if (corps.occupe) throw new SecondLecteurOccupe();
  return corps.lectures ?? null;
}

/** Un temps de la lecture, tel que le service le rend (une ligne JSON). */
interface TempsDeLecture {
  occupe?: boolean;
  vague?: 1 | 2;
  lignes?: LignePaddle[];
  /** Le second temps seulement : les cachets de la page. */
  marques?: { type: "cachet"; boite: [number, number, number, number] }[];
  modele?: string;
  millisecondes?: number;
}

/** Les temps d'une réponse en lignes JSON, à mesure qu'ils arrivent. */
async function* tempsDeLecture(corps: ReadableStream<Uint8Array>): AsyncGenerator<TempsDeLecture> {
  let reste = "";
  for await (const morceau of corps.pipeThrough(new TextDecoderStream())) {
    reste += morceau;
    let fin: number;
    while ((fin = reste.indexOf("\n")) >= 0) {
      const ligne = reste.slice(0, fin).trim();
      reste = reste.slice(fin + 1);
      if (ligne) yield JSON.parse(ligne) as TempsDeLecture;
    }
  }
  if (reste.trim()) yield JSON.parse(reste) as TempsDeLecture;
}

/**
 * Pour chaque mot de la ligne (dans l'ordre de `decouperEnMots` : les suites sans blanc du
 * texte rogné), la probabilité de son caractère le moins sûr ; rien quand le service ne
 * donne pas une probabilité par caractère.
 */
export function plusFaibles(l: Pick<LignePaddle, "texte" | "caracteres">): number[] | undefined {
  return parMot(l.texte, l.caracteres, (v) => Math.min(...v));
}

/**
 * Pour chaque mot de la ligne, le plus fort manque entre deux de ses caractères (pas après
 * le dernier : là commence le blanc qui sépare les mots) ; rien sans le service.
 */
export function plusForts(l: Pick<LignePaddle, "texte" | "manques">): number[] | undefined {
  return parMot(l.texte, l.manques, (v) => (v.length > 1 ? Math.max(...v.slice(0, -1)) : 0));
}

/** Une valeur par mot, tirée des valeurs de ses caractères. */
function parMot(
  texte: string,
  valeurs: readonly number[] | undefined,
  tirer: (v: number[]) => number,
): number[] | undefined {
  if (!valeurs || valeurs.length !== texte.length) return undefined;
  const avant = texte.length - texte.trimStart().length;
  return [...texte.trim().matchAll(/\S+/gu)].map((m) => {
    const debut = avant + (m.index ?? 0);
    return tirer(valeurs.slice(debut, debut + m[0].length));
  });
}

/** Les jetons des lignes lues : les mots de chaque ligne, situés dans la page. */
function jetonsDesLignes(lignes: readonly LignePaddle[], page: number): PageToken[] {
  const tokens: PageToken[] = [];
  for (const l of lignes) {
    const [x0, y0, x1, y1] = l.boite ?? [0, 0, 1, 1];
    if (![x0, y0, x1, y1].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const mots = decouperEnMots(l.texte, { x0, y0, x1, y1 }, page, tokens.length);
    const faibles = plusFaibles(l);
    const manques = plusForts(l);
    // La confiance de la LIGNE vaut pour chacun de ses mots. Aucun producteur
    // ne la remplissait jusqu'ici — `confiance.ts` lisait donc toujours 1, et
    // la confiance par champ se réduisait à celle de la désignation.
    // Chaque mot garde aussi son caractère le moins sûr (`faible`).
    mots.forEach((m, k) => {
      const faible = faibles?.[k];
      const manque = manques?.[k];
      tokens.push({
        ...m,
        ...(l.confiance === null ? {} : { confidence: l.confiance }),
        ...(faible === undefined ? {} : { faible }),
        ...(manque === undefined ? {} : { manque }),
      });
    });
  }
  return tokens;
}
