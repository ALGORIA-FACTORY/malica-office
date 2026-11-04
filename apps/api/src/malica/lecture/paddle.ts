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
import type { PageToken } from "@malica/socle/ports/malica";

import { PanneFournisseur } from "../../fabrique/travaux-execution.ts";

import { decouperEnMots } from "./mots.ts";

/** Ce que le service rend. Le contrat tient en trois champs. */
interface LignePaddle {
  texte: string;
  /** [x0, y0, x1, y1], NORMALISÉS de 0 à 1 dans la page. */
  boite: [number, number, number, number];
  confiance: number | null;
}

export interface ReleveDuSecondLecteur {
  tokens: PageToken[];
  modele: string;
  millisecondes: number;
  /** Lu par vagues (`lireParVagues`) : 1 si la première a suffi, 2 sinon. */
  vagues?: 1 | 2;
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
 * Le service répond 503 quand il lit déjà une pièce et que l'attente dépasse
 * `OCR_ATTENTE_MAX_S` (`infra/ocr/service.py`). Il est VIVANT : seule CETTE
 * pièce bascule sur l'autre lecteur ; le coupe-circuit, lui, reste fermé —
 * sinon une rafale de captures enverrait toutes les suivantes, pendant une
 * minute, sur le modèle payant. Sans autre lecteur, c'est une panne comme une
 * autre : la file durable la rejoue.
 */
export class SecondLecteurOccupe extends PanneFournisseur {
  constructor() {
    super("second lecteur occupé : 503");
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
  const base = process.env["OCR_URL"];
  if (!base) return "absent";
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/sante`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return "hs";
    const corps = (await r.json()) as { moteur?: unknown };
    return typeof corps.moteur === "string" && /^[a-z]{1,20}$/.test(corps.moteur)
      ? corps.moteur
      : "inconnu";
  } catch {
    return "hs";
  }
}

/** Un appel au service : sa réponse, ou la panne que la file durable sait rejouer. */
async function appeler(
  base: string,
  chemin: string,
  corps: { type: string; octets: Uint8Array | string },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const minuteur = AbortSignal.timeout(DELAI_MS);
  const arret = signal ? AbortSignal.any([signal, minuteur]) : minuteur;
  let reponse: Response;
  try {
    reponse = await fetch(`${base.replace(/\/+$/, "")}${chemin}`, {
      method: "POST",
      headers: { "Content-Type": corps.type },
      // Les octets bruts : `fetch` accepte un tableau typé tel quel.
      body: corps.octets,
      signal: arret,
    });
  } catch (e) {
    // Service éteint, réseau coupé, délai dépassé — et `OCR_URL` est bien
    // posée : quelqu'un a déployé ce lecteur et il ne répond pas.
    throw new PanneFournisseur(
      `second lecteur injoignable : ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (reponse.status === 503) throw new SecondLecteurOccupe();
  if (!reponse.ok) {
    throw new PanneFournisseur(`second lecteur : ${String(reponse.status)}`);
  }
  return (await reponse.json()) as Record<string, unknown>;
}

export async function lireAvecPaddle(
  image: Uint8Array,
  page: number,
  signal?: AbortSignal,
): Promise<ReleveDuSecondLecteur | null> {
  const base = process.env["OCR_URL"];
  if (!base) return null;
  const corps = (await appeler(
    base,
    "/lire",
    { type: "application/octet-stream", octets: image },
    signal,
  )) as { lignes?: LignePaddle[]; modele?: string; millisecondes?: number };
  const lignes = corps.lignes ?? [];
  if (lignes.length === 0) return null;
  return {
    tokens: jetonsDesLignes(lignes, page),
    modele: corps.modele ?? "paddleocr",
    millisecondes: corps.millisecondes ?? 0,
  };
}

/**
 * Lire une page par VAGUES : ne reconnaître que ce dont la preuve a besoin.
 *
 * ================================================================== POURQUOI
 *
 * Mesure du 4 novembre 2026, facture MyTek (une page, 136 lignes détectées, CPU, sans
 * GPU ni modèle de langage) : la lecture complète prend 7,3 s ; la détection seule, la
 * géométrie de la page, 0,4 s. La plupart des lignes — mentions légales, conditions —
 * ne servent à aucune preuve.
 *
 * ===================================================================== COMMENT
 *
 *   — vague 1 (`/lire?vague=1`) : la page est détectée une fois ; le TABLEAU (les rangées
 *     d'au moins quatre boîtes) est toujours lu, tous ses articles, et les boîtes courtes
 *     (étiquettes, montants, dates). Le service rend aussi les boîtes qu'il n'a pas lues ;
 *   — `prouvee` juge les jetons de la vague 1 : si la pièce se prouve, elle est lue ;
 *   — vague 2 (`/relire`) : sinon, les seules boîtes restantes sont reconnues, et les
 *     deux vagues fusionnées dans l'ordre de la page (rangée, puis abscisse).
 *
 * MyTek : vague 1 en 3,4 à 3,8 s, vague 2 en 1,0 s — 4,5 s au pire contre 7,3 s, et la
 * même preuve (totaux, cinq articles, taux) que la lecture complète.
 *
 * Le jugement est celui du moteur de preuve, déterministe : aucun modèle ne décide
 * qu'une vague suffit.
 */
export async function lireParVagues(
  image: Uint8Array,
  page: number,
  prouvee: (tokens: PageToken[]) => boolean,
  signal?: AbortSignal,
): Promise<ReleveDuSecondLecteur | null> {
  const base = process.env["OCR_URL"];
  if (!base) return null;
  const t0 = performance.now();
  const v1 = (await appeler(
    base,
    "/lire?vague=1",
    { type: "application/octet-stream", octets: image },
    signal,
  )) as { lignes?: LignePaddle[]; reste?: { polygone: unknown }[]; modele?: string };
  const lignes1 = v1.lignes ?? [];
  const reste = v1.reste ?? [];
  const premiere = jetonsDesLignes(dansLOrdreDeLaPage(lignes1), page);
  const fin = (tokens: PageToken[], vagues: 1 | 2): ReleveDuSecondLecteur | null =>
    tokens.length === 0
      ? null
      : {
          tokens,
          modele: v1.modele ?? "paddleocr",
          millisecondes: Math.round(performance.now() - t0),
          vagues,
        };
  if (reste.length === 0 || (premiere.length > 0 && prouvee(premiere))) return fin(premiere, 1);
  const v2 = (await appeler(
    base,
    "/relire",
    {
      type: "application/json",
      octets: JSON.stringify({
        image: Buffer.from(image).toString("base64"),
        polygones: reste.map((r) => r.polygone),
      }),
    },
    signal,
  )) as { lignes?: LignePaddle[] };
  return fin(jetonsDesLignes(dansLOrdreDeLaPage([...lignes1, ...(v2.lignes ?? [])]), page), 2);
}

/**
 * Deux vagues fusionnées, dans l'ordre de la page : rangée (le haut de la boîte), puis
 * abscisse — elles se lisent comme une lecture d'un seul tenant.
 */
function dansLOrdreDeLaPage(lignes: readonly LignePaddle[]): LignePaddle[] {
  return [...lignes].sort(
    (a, b) =>
      (a.boite?.[1] ?? 0) - (b.boite?.[1] ?? 0) || (a.boite?.[0] ?? 0) - (b.boite?.[0] ?? 0),
  );
}

/** Les jetons des lignes lues : les mots de chaque ligne, avec la confiance de la ligne. */
function jetonsDesLignes(lignes: readonly LignePaddle[], page: number): PageToken[] {
  const tokens: PageToken[] = [];
  for (const l of lignes) {
    const [x0, y0, x1, y1] = l.boite ?? [0, 0, 1, 1];
    if (![x0, y0, x1, y1].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const mots = decouperEnMots(l.texte, { x0, y0, x1, y1 }, page, tokens.length);
    // La confiance de la LIGNE vaut pour chacun de ses mots. Aucun producteur
    // ne la remplissait jusqu'ici — `confiance.ts` lisait donc toujours 1, et
    // la confiance par champ se réduisait à celle de la désignation.
    for (const m of mots) tokens.push(l.confiance === null ? m : { ...m, confidence: l.confiance });
  }
  return tokens;
}
