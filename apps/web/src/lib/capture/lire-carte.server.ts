/**
 * Lire une carte d'identification fiscale.
 *
 * ================================================== LA MÊME DISCIPLINE
 *
 * Deux passes, comme pour une facture. La première relève ce qui est écrit et
 * où — elle ne sait pas ce qu'elle lit, et c'est très bien : un plan de tokens
 * ne dépend pas du type de document. La seconde DÉSIGNE : elle rend
 * l'emplacement du mot qui porte chaque champ, jamais le mot lui-même.
 *
 * Aucune valeur ne vient donc du modèle. Le matricule affiché à l'écran est
 * relu dans le plan, à l'emplacement désigné, et il pointe la zone de la carte
 * où l'expert peut le vérifier de l'œil.
 *
 * ============================================ LE RÉGIME EST UN CODE, PAS UN MOT
 *
 * La carte imprime « RÉEL » ou « FORFAITAIRE » de vingt façons. Le modèle ne
 * recopie pas ce mot : il choisit un CODE dans la liste que la base lui donne,
 * comme il choisit un code de taux sur une facture. Un code hors liste n'est
 * pas retenu — et la base le refuserait de toute façon.
 *
 * ================================================== POURQUOI CE DOCUMENT-CI
 *
 * Le référentiel porte déjà : « Condition d'application du taux 3 % aux
 * personnes physiques : présentation de la CARTE D'IDENTIFICATION FISCALE
 * régime réel » — Article 52-I-a. Le droit désigne lui-même cette carte comme
 * la preuve du régime. La lire est plus sûr que de le demander : un dirigeant
 * se trompe sur son régime, la carte non.
 */

import { CarteFiscaleV1 } from "../../verticals/regalica-office/socle/contracts/carte-fiscale.v1";

import { callDeepSeek } from "../regalica/deepseek.server";
import { resolveFromTokenPlan, type FieldCitation, type ReadFlag } from "./token-plan";
import { parseJsonLoose, relever } from "./vision.server";

import { z } from "zod";

const RefSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    ordinal: z.coerce.number().int().min(0),
    ordinal_end: z.coerce.number().int().min(0).nullish(),
  })
  .nullable()
  .optional();

/**
 * Ce que le désignateur rend : des emplacements, et deux codes choisis.
 *
 * Les régimes sont les seuls champs qui ne soient pas un emplacement — parce
 * qu'ils ne sont pas une valeur à recopier mais une catégorie à reconnaître.
 * Ils sont bornés par la liste transmise, et revalidés en base.
 */
const DesignationCarte = z.object({
  raison_sociale: RefSchema,
  matricule_fiscal: RefSchema,
  adresse: RefSchema,
  activite: RefSchema,
  debut_activite: RefSchema,
  etablissement: RefSchema,
  regime_imposition: z.string().min(1).nullish(),
  regime_tva: z.string().min(1).nullish(),
});

const SYSTEM_CARTE = `Tu es un désignateur. On te donne le plan de tokens relevé sur une CARTE
D'IDENTIFICATION FISCALE tunisienne.

Tu ne transcris JAMAIS une valeur : tu renvoies uniquement l'emplacement du token qui la porte,
sous la forme {"page":n,"ordinal":n}. Si un élément est absent de la carte, renvoie null — ne
devine jamais, ne complète jamais depuis ce que tu crois savoir d'une carte tunisienne.

Réponds STRICTEMENT en JSON :
{"raison_sociale":{"page":1,"ordinal":3,"ordinal_end":5},
 "matricule_fiscal":{"page":1,"ordinal":12},
 "adresse":{"page":1,"ordinal":20,"ordinal_end":26},
 "activite":{"page":1,"ordinal":30,"ordinal_end":33},
 "debut_activite":{"page":1,"ordinal":40},
 "etablissement":{"page":1,"ordinal":45,"ordinal_end":47},
 "regime_imposition":"<un code de la liste des régimes d'imposition, ou null>",
 "regime_tva":"<un code de la liste des régimes de TVA, ou null>"}

Pour un champ TEXTUEL dont la valeur occupe plusieurs tokens contigus — une raison sociale, une
adresse, une activité —, ajoute "ordinal_end" pour couvrir tous ses tokens.
Le MATRICULE FISCAL et la DATE ne portent jamais "ordinal_end" : un seul token chacun. Un
matricule tunisien s'écrit sous la forme 1234567/A/M/000 ; s'il est éclaté sur plusieurs tokens,
désigne celui qui porte le numéro à sept chiffres.

LES DEUX RÉGIMES sont les seuls champs où tu ne désignes pas un token : tu CHOISIS un code dans
les listes fournies, d'après ce que la carte imprime. Si la carte ne le dit pas clairement, ou si
aucun code ne correspond, renvoie null. Ne choisis jamais « le plus fréquent ».

N'invente aucun champ. Une carte illisible se rend entièrement à null : c'est une réponse.`;

/**
 * Ce que la lecture rend, champ par champ.
 *
 * Écrit en toutes lettres plutôt qu'en `Record<string, unknown>` : ce type
 * traverse le réseau, et un type opaque ne se sérialise pas. Il se lit aussi
 * mieux — on voit d'un coup d'œil ce qu'une carte donne, et que tout peut être
 * nul.
 */
export interface CarteLue {
  contract: string;
  raison_sociale: string | null;
  matricule_fiscal: string | null;
  adresse: string | null;
  activite: string | null;
  debut_activite: string | null;
  etablissement: string | null;
  regime_imposition: string | null;
  regime_tva: string | null;
  cloture_exercice: string | null;
  field_confidence: Record<string, number>;
}

export interface LectureDeCarte {
  contract: string;
  carte: CarteLue;
  citations: FieldCitation[];
  flags: ReadFlag[];
  valid: boolean;
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

export async function lireCarteFiscale(params: {
  dataUrl: string;
  mime?: string;
  bytes?: Uint8Array;
  /** Les régimes que la juridiction connaît, tels que la base les porte. */
  regimes: ReadonlyArray<{ axe: "imposition" | "tva"; code: string; libelle: string }>;
}): Promise<LectureDeCarte> {
  const cle = process.env["DEEPSEEK_API_KEY"];
  if (!cle) throw new Error("DEEPSEEK_API_KEY absente : la carte ne peut pas être désignée");
  const debut = Date.now();

  const releve = await relever({
    dataUrl: params.dataUrl,
    mime: params.mime ?? "image/jpeg",
    ...(params.bytes ? { bytes: params.bytes } : {}),
  });
  const tokens = releve.tokens;
  if (tokens.length === 0) throw new Error("aucun token lisible sur la carte");

  const plan = tokens
    .map(
      (t) =>
        `${t.page}.${t.ordinal}\t${t.x0.toFixed(3)},${t.y0.toFixed(3)},${t.x1.toFixed(3)},${t.y1.toFixed(3)}\t${t.text}`,
    )
    .join("\n")
    .slice(0, 60_000);

  const listeCodes = (axe: "imposition" | "tva") =>
    params.regimes
      .filter((r) => r.axe === axe)
      .map((r) => `${r.code} — ${r.libelle}`)
      .join("\n") || "(aucun)";

  const passe = await callDeepSeek({
    apiKey: cle,
    role: "reasoner",
    messages: [
      { role: "system", content: SYSTEM_CARTE },
      {
        role: "user",
        content:
          `Codes de régime d'imposition autorisés :\n${listeCodes("imposition")}\n\n` +
          `Codes de régime de TVA autorisés :\n${listeCodes("tva")}\n\n` +
          `Plan de tokens — une ligne par mot, colonnes séparées par une tabulation :\n` +
          `page.ordinal\tx0,y0,x1,y1\ttexte\n` +
          `Les coordonnées sont normalisées entre 0 et 1, l'origine en haut à gauche : deux mots ` +
          `de même y appartiennent à la même ligne imprimée, et x croît de gauche à droite.\n\n${plan}`,
      },
    ],
  });

  const design = DesignationCarte.parse(parseJsonLoose(passe.answer));

  const citations: FieldCitation[] = [];
  const flags: ReadFlag[] = [];
  const prendre = (
    champ: string,
    ref: { page: number; ordinal: number } | null | undefined,
    genre: "text" | "date",
    zone: string,
  ): string | null => {
    const r = resolveFromTokenPlan(tokens, champ, ref ?? null, genre, zone, {
      zone,
      uiField: `carte.${champ}`,
    });
    if (r.citation) citations.push(r.citation);
    if (r.flag) flags.push(r.flag);
    return r.value;
  };

  /*
   * Un code hors liste n'est pas retenu.
   *
   * Le modèle peut inventer « micro » ou « simplifié » : ces mots existent
   * ailleurs, pas ici. On écarte plutôt que de laisser la base refuser plus
   * tard — l'écran doit montrer un champ vide à compléter, pas une erreur.
   */
  const codeConnu = (axe: "imposition" | "tva", code: string | null | undefined) =>
    code && params.regimes.some((r) => r.axe === axe && r.code === code) ? code : null;

  const candidat: CarteLue = {
    contract: "carte_fiscale.v1",
    raison_sociale: prendre("raison_sociale", design.raison_sociale, "text", "entete"),
    matricule_fiscal: prendre("matricule_fiscal", design.matricule_fiscal, "text", "entete"),
    adresse: prendre("adresse", design.adresse, "text", "entete"),
    activite: prendre("activite", design.activite, "text", "corps"),
    debut_activite: prendre("debut_activite", design.debut_activite, "date", "corps"),
    etablissement: prendre("etablissement", design.etablissement, "text", "corps"),
    regime_imposition: codeConnu("imposition", design.regime_imposition),
    regime_tva: codeConnu("tva", design.regime_tva),
    // La carte ne porte pas la clôture d'exercice : l'expert la renseigne.
    cloture_exercice: null,
    field_confidence: {},
  };

  const parsed = CarteFiscaleV1.safeParse(candidat);
  return {
    contract: parsed.success ? "carte_fiscale.v1" : "carte_fiscale.v1.partiel",
    carte: candidat,
    citations,
    flags,
    valid: parsed.success,
    model: passe.model,
    latencyMs: Date.now() - debut,
    tokensIn: passe.tokensIn,
    tokensOut: passe.tokensOut,
  };
}
