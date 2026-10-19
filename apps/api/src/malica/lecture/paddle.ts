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
}

/** Le délai au-delà duquel on renonce : un rattrapage qui s'éternise n'en est plus un. */
const DELAI_MS = 120_000;

/** Le second lecteur est-il branché ? Son absence n'est pas une panne. */
export function secondLecteurDisponible(): boolean {
  return Boolean(process.env["OCR_URL"]);
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
export async function lireAvecPaddle(
  image: Uint8Array,
  page: number,
  signal?: AbortSignal,
): Promise<ReleveDuSecondLecteur | null> {
  const base = process.env["OCR_URL"];
  if (!base) return null;

  const minuteur = AbortSignal.timeout(DELAI_MS);
  const arret = signal ? AbortSignal.any([signal, minuteur]) : minuteur;

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
    // Service éteint, réseau coupé, délai dépassé — et `OCR_URL` est bien
    // posée : quelqu'un a déployé ce lecteur et il ne répond pas.
    throw new PanneFournisseur(
      `second lecteur injoignable : ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!reponse.ok) {
    throw new PanneFournisseur(`second lecteur : ${String(reponse.status)}`);
  }

  const corps = (await reponse.json()) as {
    lignes?: LignePaddle[];
    modele?: string;
    millisecondes?: number;
  };
  const lignes = corps.lignes ?? [];
  if (lignes.length === 0) return null;

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

  return {
    tokens,
    modele: corps.modele ?? "paddleocr",
    millisecondes: corps.millisecondes ?? 0,
  };
}
