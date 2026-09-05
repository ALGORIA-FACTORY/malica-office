/**
 * Le conseil — la forme que Regalica donne à une réponse de droit, et la
 * lecture qu'on en fait.
 *
 * ================================================================ LE PRINCIPE
 *
 * Quand un client pose une question, on ne sait pas d'avance si c'est du
 * conseil (« puis-je déduire la TVA sur ce véhicule ? ») ou une lecture du
 * dossier (« quel est mon crédit de TVA ? »). C'est le modèle qui le dit — et
 * il le dit dans un objet structuré, pas dans une phrase qu'il faudrait
 * deviner : la réponse, si c'est du conseil, le sujet, sa certitude, les
 * articles sur lesquels il s'appuie, et son doute.
 *
 * ============================================ CE QUE CE MODULE NE CROIT PAS
 *
 * Les sources. Le modèle DÉSIGNE des articles ; ce module ne retient que ceux
 * qui lui ont été transmis. Un article cité qui ne figure pas dans les
 * fragments n'est pas une source : c'est une invention, et elle tombe. C'est
 * la même règle que pour les montants d'une pièce (R2) : on relit dans ce
 * qu'on a montré, jamais dans ce qu'il répond.
 *
 * Et sans source, il n'y a pas de certitude : une réponse de conseil qui ne
 * s'appuie sur aucun texte vaut zéro, quoi que le modèle en dise. Elle sera
 * remise au cabinet s'il y en a un, ou dite comme telle au client.
 */

import { z } from "zod";

import type { SourceCitee } from "@regalica/socle/ports/repositories";

import type { FragmentDeDroit } from "./corpus.ts";

export interface ReponseDeConseil {
  /** La question relève-t-elle du conseil — appliquer ou interpréter une règle ? */
  conseil: boolean;
  /** Le sujet, en quelques mots. Sert à voir revenir les mêmes questions. */
  theme: string | null;
  /** Ce que le client lira. */
  reponse: string;
  /** 0..1, telle que déclarée — ramenée à zéro sans source. */
  certitude: number;
  /** Les articles transmis sur lesquels la réponse s'appuie. */
  sources: SourceCitee[];
  /** Ce qui la fait hésiter, dans ses mots. */
  doute: string | null;
  /** La réponse était-elle bien l'objet demandé ? Sinon, on a lu du texte libre. */
  structuree: boolean;
}

/**
 * La consigne de forme. Elle vient APRÈS la doctrine : elle dit comment
 * répondre, pas quoi répondre. Le mot « JSON » y figure parce que le mode
 * de sortie du fournisseur l'exige dans l'invite.
 */
export function consigneDeForme(): string {
  return [
    `LA FORME DE TA RÉPONSE`,
    `Tu rends UNIQUEMENT un objet JSON, sans texte autour, avec exactement ces clés :`,
    `- "reponse" : ta réponse à la personne, telle qu’elle la lira — dans la langue et la forme décrites plus haut.`,
    `- "conseil" : true si la question demande d’appliquer ou d’interpréter une règle fiscale, sociale ou réglementaire (un taux, une déduction, un régime, une obligation, un délai, une pénalité) ; false si elle porte seulement sur les chiffres du dossier, une pièce, une écriture ou une échéance déjà calculée.`,
    `- "theme" : le sujet en trois à cinq mots, sans verbe, comme « Déduction de TVA sur véhicule » ; null si ce n’est pas du conseil.`,
    `- "certitude" : un nombre entre 0 et 1 — ta confiance que la réponse est juste ET complète pour CETTE personne. 1 : texte clair, en vigueur, un seul texte possible, tous les faits connus. Baisse-la dès qu’un fait manque, que deux textes se recoupent mal, qu’une note commune seule répond, que le régime du client n’est pas renseigné, ou qu’une lecture est marquée partielle ou incertaine. Si aucun texte transmis ne répond : 0.`,
    `- "sources" : les articles TRANSMIS sur lesquels ta réponse s’appuie, sous la forme [{"corpus": "…", "numero": "…"}], recopiés exactement tels qu’ils te sont donnés — jamais un article qui ne t’a pas été transmis. Vide si aucun.`,
    `- "doute" : en une ou deux phrases, ce qui te fait hésiter et ce que l’expert-comptable devrait vérifier avant d’envoyer ; null si rien.`,
    `Si "conseil" est false : "theme" et "doute" valent null, "sources" est vide, "certitude" vaut 1.`,
  ].join("\n");
}

const SourceSchema = z.object({
  corpus: z.coerce.string().default(""),
  numero: z.coerce.string().default(""),
});

const ReponseSchema = z.object({
  reponse: z.coerce.string().default(""),
  conseil: z.coerce.boolean().default(false),
  theme: z.string().nullish(),
  certitude: z.coerce.number().min(0).max(1).catch(0),
  sources: z.array(SourceSchema).catch([]),
  doute: z.string().nullish(),
});

/** Le premier objet JSON que porte un texte, débarrassé d'une clôture de code. */
function extraireObjet(brut: string): unknown | null {
  const sansCloture = brut.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const debut = sansCloture.indexOf("{");
  const fin = sansCloture.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return null;
  try {
    return JSON.parse(sansCloture.slice(debut, fin + 1)) as unknown;
  } catch {
    return null;
  }
}

const propre = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Les sources désignées, relues dans les fragments transmis.
 *
 * Un corpus absent ou mal recopié ne disqualifie pas la désignation si le
 * numéro ne correspond qu'à un seul fragment : « art. 9 » est sans ambiguïté
 * quand un seul article 9 a été montré. Deux fragments au même numéro et
 * pas de corpus, c'est une désignation qu'on ne peut pas relire — elle tombe.
 */
export function resoudreLesSources(
  designees: ReadonlyArray<{ corpus: string; numero: string }>,
  fragments: readonly FragmentDeDroit[],
): SourceCitee[] {
  const vues = new Set<string>();
  const sources: SourceCitee[] = [];
  for (const d of designees) {
    const numero = propre(d.numero);
    const corpus = propre(d.corpus);
    if (!numero) continue;
    const memeNumero = fragments.filter((f) => propre(f.numero) === numero);
    const trouve =
      memeNumero.find((f) => propre(f.corpus) === corpus) ??
      (memeNumero.length === 1 ? memeNumero[0] : undefined);
    if (!trouve) continue;
    const cle = `${trouve.corpus}|${trouve.numero}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    sources.push({
      corpus: trouve.corpus,
      numero: trouve.numero,
      validFrom: trouve.validFrom,
      validTo: trouve.validTo,
      langue: trouve.langue,
    });
  }
  return sources;
}

/**
 * Ce que le modèle a rendu, relu.
 *
 * Un texte qui n'est pas l'objet demandé n'est pas jeté : on le garde comme
 * réponse, et on le traite avec prudence — c'est du conseil si du droit avait
 * été transmis, et sa certitude vaut zéro. Mieux vaut remettre au cabinet une
 * réponse qu'on n'a pas su lire que de l'envoyer seule.
 */
export function lireReponseDeConseil(
  brut: string,
  fragments: readonly FragmentDeDroit[],
): ReponseDeConseil {
  const objet = extraireObjet(brut);
  const lu = objet === null ? null : ReponseSchema.safeParse(objet);
  if (!lu || !lu.success || lu.data.reponse.trim().length === 0) {
    return {
      conseil: fragments.length > 0,
      theme: null,
      reponse: brut.trim(),
      certitude: 0,
      sources: [],
      doute: null,
      structuree: false,
    };
  }
  const d = lu.data;
  const sources = d.conseil ? resoudreLesSources(d.sources, fragments) : [];
  const certitude = d.conseil
    ? sources.length === 0
      ? 0
      : Math.round(d.certitude * 100) / 100
    : 1;
  return {
    conseil: d.conseil,
    theme: d.conseil ? d.theme?.trim().slice(0, 120) || null : null,
    reponse: d.reponse.trim(),
    certitude,
    sources,
    doute: d.conseil ? d.doute?.trim().slice(0, 1000) || null : null,
    structuree: true,
  };
}
