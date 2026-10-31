/**
 * Le jeu synthétique, mesuré de bout en bout sur la VRAIE chaîne.
 *
 * ================================================================= POURQUOI
 *
 * Cent factures fictives (`outils/jeu-synthetique/`) : français, arabe et
 * hybride ; PDF tapés, photos et carnets remplis à la main. Chacune porte ce
 * qu'elle imprime et ce qu'elle doit produire — les champs lus, l'écriture,
 * ou le refus nommé —, calculés depuis sa spécification, jamais depuis le
 * moteur mesuré. Ce module les fait passer par la chaîne de production :
 *
 *   relevé       `relever()` (vision.ts) — la couche de texte d'un PDF, ou
 *                PaddleOCR pour une image, et le recollage des milliers ;
 *   désignation  la désignation ATTENDUE (voir plus bas) ;
 *   relecture    `buildExtractFromTokenPlan` — les valeurs relues au plan ;
 *   jugement     `jugerLaLecture` puis `composerLaProposition`, par `jouer`
 *                de la mesure des propositions, avec le référentiel relevé
 *                en base (`referentiel-d-essai.json`).
 *
 * ========================================== CE QUE LA DÉSIGNATION ATTENDUE EST
 *
 * Le désignateur de production est un modèle payant (DeepSeek) ou une recette
 * de la fabrique. Aucun des deux ne tourne ici : un appel payant est exclu, et
 * aucune recette n'existe pour ces émetteurs inventés. La désignation jouée
 * est donc celle d'un désignateur IDÉAL, exactement au sens du jeu d'or : les
 * jetons du plan RÉELLEMENT relevé dont le centre tombe dans la boîte où le
 * rendu a posé le champ (`NNN.boites.json`). Elle ne lit aucune valeur de la
 * spécification : si le relevé a mal lu, coupé ou perdu un montant, la
 * relecture le rend mal lu, coupé ou absent — et la mesure le compte.
 *
 * Ce banc mesure donc le relevé, la relecture, le jugement et la proposition.
 * Il ne mesure PAS le désignateur ; un écart venu de lui reste à mesurer
 * contre le vrai modèle (l'épreuve réelle).
 *
 * ================================================================ CE QU'IL TAIT
 *
 * Rien. Une image sans second lecteur joignable n'est pas comptée comme lue :
 * elle sort « non mesurée », avec la raison. Un PDF dont la couche de texte a
 * perdu ses mots (`laCoucheSeCroit`) est une image pour la production : il
 * sort de même. Un champ que le désignateur idéal
 * ne peut pas désigner (jetons non contigus dans le plan) est dit.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { DEVISE_D_ESSAI, REGLE_DE_CHANGE_D_ESSAI } from "../../scan/referentiel-d-essai.ts";
import { DEVISES_LUES_D_ESSAI } from "../../scan/devise-d-essai.ts";
import {
  jouer,
  lectureCitee,
  type CasDeMesure,
  type Issue,
} from "../../scan/mesure-des-propositions.ts";

import { auChemin, type CasDOr } from "./jeu-d-or.ts";
import { secondLecteurDisponible } from "./paddle.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import { readPdfTextLayer } from "./pdf-text.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import { laCoucheSeCroit, relever, type VisionSelection } from "./vision.ts";

const DOSSIER_DU_JEU = new URL("../../../../../outils/jeu-synthetique/", import.meta.url);

type LigneAttendue = [string, string, string, string?];

/** Un cas tel que `composer.mjs` l'écrit. */
export interface CasSynthetique {
  id: string;
  synthetique: true;
  provenance: string;
  langue: "fr" | "ar" | "hybride";
  rendu: "pdf" | "photo" | "manuscrit";
  scenario: string;
  defaut: string | null;
  dossier: { nom: string; identifiantFiscal: string };
  piece: {
    sens: "facture_achat" | "facture_vente";
    recueLe: string;
    titre: string;
    devise: string;
    exposant: number;
    articles: Array<{ codeTaxe: string }>;
    tableauParTaux: boolean;
    parTaux: Array<{ code: string }>;
    droits: string[];
    imprime: Record<string, string>;
  };
  attendu: {
    champs: Record<string, string | null>;
    ecriture: {
      journal: string;
      lignes: LigneAttendue[];
      origines?: Array<[string, string]>;
    } | null;
    issue: { type: "ecriture"; reserve?: string } | { type: "refus"; motifs: string[] };
    /** L'écriture du paramétrage et la réserve qui dit la question à trancher (`CasDeMesure`). */
    aTrancher?: { reserve: string; ecriture: { journal: string; lignes: LigneAttendue[] } };
    cours?: { devise: string; taux: string; unite: number; date: string };
  };
}

type Boites = Record<string, { x0: number; y0: number; x1: number; y1: number }>;

/** Les cas du jeu, dans l'ordre de leur numéro. */
export function lesCas(): CasSynthetique[] {
  const dossier = new URL("cas/", DOSSIER_DU_JEU);
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, dossier), "utf8")) as CasSynthetique);
}

/* ------------------------------------------------------------- le relevé */

type Releve = { tokens: PageToken[]; lecteur: string } | { tokens: null; raison: string };

/**
 * Comment le banc relève : comme la production, ou — DIAGNOSTIC — en croyant
 * la couche de texte d'un PDF même quand elle a perdu des mots.
 *
 * Le diagnostic n'est pas une mesure de la chaîne : la production relit ces
 * PDF en image. Il isole le JUGEMENT et la PROPOSITION du lecteur — les
 * montants, les matricules et les dates de ces PDF sont exacts dans leur
 * couche, seuls leurs mots arabes sont perdus —, pour que le Socle reste
 * mesuré sur les 27 PDF arabes et hybrides tant qu'aucun second lecteur ne
 * tourne ici. Ses chiffres sont rapportés à part, jamais mêlés à la mesure.
 */
export type ModeDeReleve = "production" | "diagnostic_couche_crue";

/** Le lecteur que le diagnostic inscrit : jamais celui d'une mesure. */
export const LECTEUR_DU_DIAGNOSTIC = "pdf-text (diagnostic)";

/**
 * Le relevé de la pièce par le chemin de production. Une image ne se relève
 * que si PaddleOCR est joignable (`OCR_URL`) : le modèle de vision est payant,
 * et ce banc n'en appelle aucun (`sansAppelPayant`).
 */
async function releverLaPiece(cas: CasSynthetique, mode: ModeDeReleve): Promise<Releve> {
  const pdf = cas.rendu === "pdf";
  const fichier = new URL(`rendus/${cas.id}.${pdf ? "pdf" : "jpg"}`, DOSSIER_DU_JEU);
  if (!existsSync(fichier))
    return {
      tokens: null,
      raison: `rendu absent : node outils/jeu-synthetique/rendre.mjs ${cas.id}`,
    };
  if (!pdf && !secondLecteurDisponible())
    return { tokens: null, raison: "image : PaddleOCR non joignable (OCR_URL absente)" };
  const octets = new Uint8Array(readFileSync(fichier));
  // Un PDF dont la couche de texte a perdu ses mots se relit en image, comme
  // en production (`laCoucheSeCroit`) : sans second lecteur, il n'est pas lu.
  // Le diagnostic la croit : c'est le chemin `pdf-text` de `relever`, la
  // couche et le recollage des milliers.
  const couche = pdf ? await readPdfTextLayer(octets) : null;
  if (couche && !laCoucheSeCroit(couche) && mode === "diagnostic_couche_crue")
    return { tokens: recollerLesMilliers(couche.tokens), lecteur: LECTEUR_DU_DIAGNOSTIC };
  if (couche && !laCoucheSeCroit(couche) && !secondLecteurDisponible())
    return {
      tokens: null,
      raison:
        "PDF au texte perdu (glyphes sans Unicode), relu en image : PaddleOCR non joignable (OCR_URL absente)",
    };
  const mime = pdf ? "application/pdf" : "image/jpeg";
  const r = await relever({
    dataUrl: `data:${mime};base64,${Buffer.from(octets).toString("base64")}`,
    mime,
    bytes: octets,
  });
  return { tokens: r.tokens, lecteur: r.lecteur };
}

/**
 * Aucun appel payant : ce banc retire les clés des modèles payants de son
 * propre processus. Le relevé d'une image tombe alors sur PaddleOCR seul, et
 * une lecture qui voudrait le modèle de vision échoue au lieu de payer.
 */
function sansAppelPayant(): void {
  for (const cle of ["QWEN_API_KEY", "DEEPSEEK_API_KEY"]) Reflect.deleteProperty(process.env, cle);
}

/* ------------------------------------------------------------- la désignation */

/** Une marge d'un demi-millimètre autour de la boîte : un jeton n'en déborde pas plus. */
const MARGE = 0.002;

interface Designation {
  selection: VisionSelection;
  /** Les champs que le désignateur idéal n'a pas pu désigner, et pourquoi. */
  impossibles: Record<string, string>;
}

/** La désignation attendue : les jetons dont le centre tombe dans la boîte du champ. */
function designationAttendue(
  cas: CasSynthetique,
  tokens: readonly PageToken[],
  boites: Boites,
): Designation {
  const impossibles: Record<string, string> = {};
  const designer = (chemin: string): TokenRef | null => {
    const b = boites[chemin];
    if (!b) return null;
    const dedans = tokens.filter((t) => {
      const cx = (t.x0 + t.x1) / 2;
      const cy = (t.y0 + t.y1) / 2;
      return cx >= b.x0 - MARGE && cx <= b.x1 + MARGE && cy >= b.y0 - MARGE && cy <= b.y1 + MARGE;
    });
    if (dedans.length === 0) {
      impossibles[chemin] = "aucun jeton relevé dans la boîte du champ";
      return null;
    }
    const page = dedans[0]!.page;
    // Un désignateur cite la valeur, jamais la ponctuation qui la précède ou la
    // suit (« : 6443013U/A/M/000 ») : la couche de texte répartit la largeur
    // d'un fragment au prorata des caractères, et le deux-points d'une
    // étiquette peut tomber dans la boîte de la valeur.
    const surPage = dedans.filter((t) => t.page === page).sort((a, b) => a.ordinal - b.ordinal);
    const ponctuation = (t: PageToken) => /^[:;,.\-–—]+$/u.test(t.text.trim());
    while (surPage.length > 1 && ponctuation(surPage[0]!)) surPage.shift();
    while (surPage.length > 1 && ponctuation(surPage.at(-1)!)) surPage.pop();
    const ordinaux = surPage.map((t) => t.ordinal);
    const premier = ordinaux[0]!;
    const dernier = ordinaux.at(-1)!;
    if (dernier - premier + 1 !== ordinaux.length) {
      impossibles[chemin] = `jetons ${ordinaux.join(",")} non contigus dans le plan`;
      return null;
    }
    return premier === dernier
      ? { page, ordinal: premier }
      : { page, ordinal: premier, ordinalEnd: dernier };
  };
  const p = cas.piece;
  const lines = p.tableauParTaux
    ? p.parTaux.map((l, i) => ({
        label: l.code,
        tax_code: l.code,
        base_ht: designer(`lines[${i}].base_ht`),
        vat_amount: designer(`lines[${i}].vat_amount`),
        ttc: null,
      }))
    : // Une facture à un taux sans tableau : la ligne se lit au pied, comme
      // le jeu d'or le désigne.
      [
        {
          label: p.parTaux[0]!.code,
          tax_code: p.parTaux[0]!.code,
          base_ht: designer("totals.base_ht"),
          vat_amount: designer("totals.vat"),
          ttc: null,
        },
      ];
  const selection = {
    document_kind: p.sens,
    currency: p.devise,
    issuer: designer("issuer"),
    document_date: designer("document_date"),
    references: {
      numero: designer("references.numero"),
      matricule_fiscal: designer("references.matricule_fiscal"),
      matricule_fiscal_client: designer("references.matricule_fiscal_client"),
    },
    lines,
    articles: p.articles.map((a, k) => ({
      designation: designer(`articles[${k}].designation`),
      quantity: designer(`articles[${k}].quantity`),
      unit_price_ht: designer(`articles[${k}].unit_price_ht`),
      unit_price_ttc: null,
      total_ht: designer(`articles[${k}].total_ht`),
      tax_code: a.codeTaxe,
    })),
    other_charges: p.droits.map((code, k) => ({
      code,
      amount: designer(`other_charges[${k}].amount`),
    })),
    totals: {
      base_ht: designer("totals.base_ht"),
      vat: designer("totals.vat"),
      ttc: designer("totals.ttc"),
    },
    overall_confidence: 0.9,
  } as unknown as VisionSelection;
  return { selection, impossibles };
}

/* ------------------------------------------------------------- la mesure */

/** L'issue d'un cas, rapportée à ce que le cas attend. */
export type Verdict =
  | "exacte"
  /** L'écriture du paramétrage, avec la réserve qui dit la question à trancher. */
  | "a_trancher"
  | "fausse"
  | "refus_juste"
  | "refus_mal_nomme"
  | "refus_injuste"
  | "non_mesuree";

export interface ResultatDuCas {
  id: string;
  langue: CasSynthetique["langue"];
  rendu: CasSynthetique["rendu"];
  scenario: string;
  defaut: string | null;
  /** Ce que le cas attend : une écriture, ou un refus nommé. */
  issueAttendue: "ecriture" | "refus";
  lecteur: string | null;
  champs: { total: number; exacts: number; faux: string[] };
  designationImpossible: Record<string, string>;
  verdict: Verdict;
  detail: string;
}

/**
 * Le refus est-il l'un de ceux qu'on attend ? Un attendu nomme une famille de
 * contrôles (« coherence_arithmetique ») ou un code précis
 * (« proposition/a_completer ») ; le motif peut en porter plusieurs (« a/b+c »).
 */
const refusAttendu = (motif: string, attendus: readonly string[]): boolean =>
  motif
    .split("+")
    .some((partie) => attendus.includes(partie) || attendus.includes(partie.split("/")[0]!));

/** Le cas du jeu d'or que ce cas synthétique devient, une fois relu. */
function enCasDOr(cas: CasSynthetique, tokens: PageToken[], selection: VisionSelection): CasDOr {
  return {
    nom: `synthétique ${cas.id}`,
    provenance: cas.provenance,
    synthetique: true,
    decimales: cas.piece.exposant,
    matriculeDossier: cas.dossier.identifiantFiscal,
    tokens,
    designation: selection,
    attendu: cas.attendu.champs,
    imprime: cas.piece.imprime,
  };
}

/** Le cours que `app.cours_applicable` rendrait pour la devise de la pièce. */
function coursDuCas(cas: CasSynthetique): CasDeMesure["cours"] {
  const c = cas.attendu.cours;
  if (!c || !REGLE_DE_CHANGE_D_ESSAI) return undefined;
  return {
    devise: c.devise,
    id: `00000000-0000-4000-8000-${cas.id.padStart(12, "0")}`,
    date: c.date,
    taux: c.taux,
    unite: c.unite,
    source: REGLE_DE_CHANGE_D_ESSAI.source,
    origine: "import",
    motif: null,
  };
}

async function mesurerUnCas(cas: CasSynthetique, mode: ModeDeReleve): Promise<ResultatDuCas> {
  const base = {
    id: cas.id,
    langue: cas.langue,
    rendu: cas.rendu,
    scenario: cas.scenario,
    defaut: cas.defaut,
    issueAttendue: cas.attendu.issue.type,
  };
  const releve = await releverLaPiece(cas, mode);
  if (releve.tokens === null) {
    return {
      ...base,
      lecteur: null,
      champs: { total: Object.keys(cas.attendu.champs).length, exacts: 0, faux: [] },
      designationImpossible: {},
      verdict: "non_mesuree",
      detail: releve.raison,
    };
  }
  const boites = (
    JSON.parse(readFileSync(new URL(`rendus/${cas.id}.boites.json`, DOSSIER_DU_JEU), "utf8")) as {
      champs: Boites;
    }
  ).champs;
  const { selection, impossibles } = designationAttendue(cas, releve.tokens, boites);
  const lu = buildExtractFromTokenPlan({
    tokens: releve.tokens,
    selection,
    devises: DEVISES_LUES_D_ESSAI,
    deviseDuDossier: DEVISE_D_ESSAI,
    matriculeDossier: cas.dossier.identifiantFiscal,
  });
  const orCas = enCasDOr(cas, releve.tokens, selection);
  const faux = Object.entries(orCas.attendu)
    .map(([chemin, attendu]) => ({ chemin, attendu, lu: auChemin(lu.extract, chemin) }))
    .filter((c) => c.lu !== c.attendu)
    .map((c) => `${c.chemin} : lu ${JSON.stringify(c.lu)}, attendu ${JSON.stringify(c.attendu)}`);

  const attendu = cas.attendu;
  const cours = coursDuCas(cas);
  const mesure: CasDeMesure = {
    nom: orCas.nom,
    provenance: orCas.provenance,
    dossier: cas.dossier,
    lecture: {
      ...lectureCitee(releve.tokens, lu, selection.overall_confidence, cas.piece.recueLe),
      // Le diagnostic croit une couche dont le titre est PERDU : le contrôle
      // de la nature bloquerait tout, et c'est juste (`nature_piece`). Pour
      // mesurer le reste du jugement, il reçoit le titre que le rendu a
      // imprimé — celui qu'un lecteur d'image relèverait. C'est la seule
      // valeur du diagnostic qui vienne de la spécification, et il le dit.
      ...(releve.lecteur === LECTEUR_DU_DIAGNOSTIC ? { titre: cas.piece.titre } : {}),
    },
    attendu: attendu.ecriture,
    ...(attendu.issue.type === "ecriture" && attendu.issue.reserve
      ? { reserve: attendu.issue.reserve }
      : {}),
    ...(attendu.aTrancher
      ? { aTrancher: { reserve: attendu.aTrancher.reserve, attendu: attendu.aTrancher.ecriture } }
      : {}),
    ...(cours ? { cours } : {}),
  };
  const issue: Issue = jouer(mesure);
  let verdict: Verdict;
  let detail: string;
  if (attendu.issue.type === "ecriture") {
    verdict =
      issue.type === "exacte" || issue.type === "a_trancher" || issue.type === "fausse"
        ? issue.type
        : "refus_injuste";
    detail =
      "cause" in issue
        ? issue.cause
        : "motif" in issue
          ? issue.motif
          : "reserve" in issue
            ? `proposée avec la réserve « ${issue.reserve} » : à trancher par le cabinet`
            : "";
  } else if (issue.type === "fausse" || issue.type === "exacte" || issue.type === "a_trancher") {
    verdict = "fausse";
    detail = `proposée alors que le refus « ${attendu.issue.motifs.join(" ou ")} » était attendu`;
  } else {
    const motifs = attendu.issue.motifs;
    verdict = refusAttendu(issue.motif, motifs) ? "refus_juste" : "refus_mal_nomme";
    detail = issue.motif;
  }
  return {
    ...base,
    lecteur: releve.lecteur,
    champs: {
      total: Object.keys(orCas.attendu).length,
      exacts: Object.keys(orCas.attendu).length - faux.length,
      faux,
    },
    designationImpossible: impossibles,
    verdict,
    detail,
  };
}

export async function mesurerLeJeu(
  cas: readonly CasSynthetique[] = lesCas(),
  mode: ModeDeReleve = "production",
): Promise<ResultatDuCas[]> {
  sansAppelPayant();
  const resultats: ResultatDuCas[] = [];
  for (const c of cas) resultats.push(await mesurerUnCas(c, mode));
  return resultats;
}

/* ------------------------------------------------------------- le rapport */

interface Agregat {
  cas: number;
  mesures: number;
  champs: number;
  champsExacts: number;
  attendues: number;
  exactes: number;
  aTrancher: number;
  fausses: number;
  refusAttendus: number;
  refusJustes: number;
  refusMalNommes: number;
  refusInjustes: number;
}

function agreger(r: readonly ResultatDuCas[]): Agregat {
  const m = r.filter((x) => x.verdict !== "non_mesuree");
  const n = (v: Verdict) => m.filter((x) => x.verdict === v).length;
  return {
    cas: r.length,
    mesures: m.length,
    champs: m.reduce((s, x) => s + x.champs.total, 0),
    champsExacts: m.reduce((s, x) => s + x.champs.exacts, 0),
    attendues: m.filter((x) => x.issueAttendue === "ecriture").length,
    exactes: n("exacte"),
    aTrancher: n("a_trancher"),
    fausses: n("fausse"),
    refusAttendus: m.filter((x) => x.issueAttendue === "refus").length,
    refusJustes: n("refus_juste"),
    refusMalNommes: n("refus_mal_nomme"),
    refusInjustes: n("refus_injuste"),
  };
}

const pc = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)} %)`);

function ligne(nom: string, a: Agregat): string {
  return `| ${nom} | ${a.cas} | ${a.mesures} | ${pc(a.champsExacts, a.champs)} | ${pc(a.exactes, a.attendues)} | ${a.aTrancher} | ${a.fausses} | ${pc(a.refusJustes, a.refusAttendus)} | ${a.refusMalNommes} | ${a.refusInjustes} |`;
}

/** Le tableau de mesure, en Markdown : global, puis par langue, rendu et contenu. */
export function tableau(r: readonly ResultatDuCas[]): string {
  const entete =
    "| | cas | mesurés | champs exacts | écritures exactes | à trancher | **fausses** | refus justes | refus mal nommés | refus injustes |\n" +
    "|---|---|---|---|---|---|---|---|---|---|";
  const par = <K extends keyof ResultatDuCas>(cle: K) =>
    [...new Set(r.map((x) => String(x[cle])))]
      .sort()
      .map((v) => ligne(`${String(cle)} = ${v}`, agreger(r.filter((x) => String(x[cle]) === v))));
  return [
    entete,
    ligne("**tous**", agreger(r)),
    ...par("langue"),
    ...par("rendu"),
    ...par("scenario"),
    ...par("defaut"),
  ].join("\n");
}

/** Le détail des issues qui ne sont pas justes, et des champs mal lus. */
export function ecarts(r: readonly ResultatDuCas[]): string {
  const lignes: string[] = [];
  for (const x of r) {
    if (x.verdict === "non_mesuree") continue;
    const juste = x.verdict === "exacte" || x.verdict === "refus_juste";
    if (juste && x.champs.faux.length === 0 && Object.keys(x.designationImpossible).length === 0)
      continue;
    lignes.push(
      `- **${x.id}** (${x.langue}, ${x.rendu}, ${x.scenario}${x.defaut ? `, défaut ${x.defaut}` : ""}) — ${x.verdict}${x.detail ? ` : ${x.detail}` : ""}`,
    );
    for (const f of x.champs.faux) lignes.push(`  - champ ${f}`);
    for (const [c, raison] of Object.entries(x.designationImpossible))
      lignes.push(`  - non désigné ${c} : ${raison}`);
  }
  return lignes.join("\n");
}
