/**
 * LA VÉRIFICATION D'UNE PIÈCE PAR LA RELECTURE CIBLÉE — le travail `relecture_cases` de la
 * file, que le coureur prend juste après la lecture (décision du dirigeant, 8 novembre 2026).
 *
 * La personne voit déjà sa pièce, « en vérification » ; ce travail rend, quelques secondes
 * plus tard, l'une de trois issues, et toujours un motif (`CompteRendu`) que l'écran lit :
 *
 *   verification.prouvee        Claude a relu des cases, le Sudoku a refermé TOUTES les
 *                               contraintes de la pièce avec elles : une lecture nouvelle
 *                               (R7), désignée par la preuve, est persistée par la porte des
 *                               relectures, qui revérifie qu'aucune personne n'a corrigé.
 *   verification.non_prouvee    la relecture n'a pas suffi : rien ne change, et le détail
 *                               dit la case à vérifier (`motifDeNonPreuve`).
 *   verification.non_relue.*    on n'a RIEN appelé — relecture coupée entre-temps, modèle
 *                               sans tarif, budget de Claude absent ou épuisé, clé absente,
 *                               pas d'image — ou Claude n'a pas répondu. La lecture reste,
 *                               et le motif aussi. Le repli DeepSeek ne s'applique pas : la
 *                               relecture d'image est le fait de Claude seul.
 *
 * L'EXCEPTION À R2 est décrite dans `relecture-ciblee.ts` : le modèle voit une case, il
 * transcrit, il ne désigne rien ; le Sudoku seul affirme.
 *
 * Le modèle, la consigne, le nombre de cases et le budget viennent de la base
 * (`public.relecture_ciblee_configuration`, R8, R10) ; chaque appel se journalise à son
 * tarif (`agents_run_log`), payé ou non retenu — une dépense non mesurée est une dépense
 * sans plafond, et c'est elle que le plafond de Claude mord.
 */
import { traceDOrigineDeLaPiece } from "../../db.ts";
import type { CompteRendu } from "../../fabrique/travaux-execution.ts";
import { tracerUnTravail } from "../../observabilite/journal.ts";
import { noterLObjet } from "../../observabilite/trace.ts";
import type { AppelApi } from "../appel-local.ts";
import { MODELE_SUDOKU, ROLE_SUDOKU } from "../modeles.ts";

import { envoyerAClaude } from "./claude.ts";
import { extrairePagesScannees } from "./pdf-image.ts";
import { LECTEURS, lectureAPersister, preparer } from "./read-flow.ts";
import {
  casesARelire,
  corpsDeLaRequete,
  decouper,
  enLots,
  lireLaReponse,
  motifDeNonPreuve,
  planCandidat,
  type ReponseBrute,
} from "./relecture-ciblee.ts";
import type { PageToken } from "./token-plan.ts";
import type { Lecteur, VisionRead } from "./vision.ts";

/** L'agent du journal : sa dépense compte au budget de Claude, par le modèle. */
const AGENT = "malica.lecture.relecture_ciblee";
/** Un appel qui ne répond pas en ce temps est une panne : la vérification ne s'éternise pas. */
const DELAI_D_UN_APPEL_MS = 30_000;

/** Ce que la base rend de la configuration. */
interface Configuration {
  actif: boolean;
  modele: string | null;
  casesMax: number;
  lot: number;
  consigne: string | null;
  tarife: boolean;
  /** Le maillon anthropic de la chaîne de désignation : son budget. Nul : aucun budget. */
  budget: { epuise: boolean } | null;
}

export function lireLaConfiguration(brute: unknown): Configuration {
  const x = (brute ?? {}) as Record<string, unknown>;
  const consigne = (x["consigne"] ?? null) as { texte?: unknown } | null;
  const budget = (x["budget"] ?? null) as { epuise?: unknown } | null;
  return {
    actif: x["actif"] === true,
    modele: typeof x["modele"] === "string" ? x["modele"] : null,
    casesMax: Number(x["cases_max"] ?? 0),
    lot: Number(x["lot"] ?? 1),
    consigne: typeof consigne?.texte === "string" ? consigne.texte : null,
    tarife: x["tarife"] === true,
    budget: budget ? { epuise: budget.epuise !== false } : null,
  };
}

/** Ce que `fabrique.verification_a_faire` rend. */
interface VerificationAFaire {
  pieceId: string;
  extractionId: string;
  mode: string | null;
  consigne: { lecteur: string; paddleTente: boolean; plan: PageToken[] };
  abstention: string | null;
}

/** Ce qu'on injecte : l'appel à Claude et la clé. Les épreuves n'appellent jamais le réseau. */
export interface DependancesDeVerification {
  /** Un lot, son corps de requête ; rend la réponse de l'API Messages et sa durée. */
  appeler?: (corps: unknown) => Promise<{ reponse: ReponseBrute; latencyMs: number }>;
  cle?: string | undefined;
  /** La préparation de la pièce (contexte, Sudoku, octets) ; par défaut celle de la lecture. */
  preparer?: typeof preparer;
}

/** La page à découper : l'image déposée, ou la première page d'un PDF scanné. */
async function imageDeLaPage(
  octets: Uint8Array,
  mime: string,
): Promise<Uint8Array | string | null> {
  if (mime.startsWith("image/")) return octets;
  if (mime === "application/pdf")
    return (await extrairePagesScannees(octets, 1))[0]?.dataUrl ?? null;
  return null;
}

export async function verifierLesCases(
  api: AppelApi,
  travail: { travailId: string; pieceId: string; tentative?: number },
  dependances: DependancesDeVerification = {},
): Promise<CompteRendu> {
  const parente = await traceDOrigineDeLaPiece(travail.pieceId).catch(() => null);
  return tracerUnTravail("relecture_cases", parente, () => verifier(api, travail, dependances), {
    travailId: travail.travailId,
    ...(travail.tentative === undefined ? {} : { tentative: travail.tentative }),
  });
}

async function verifier(
  api: AppelApi,
  travail: { travailId: string; pieceId: string },
  dep: DependancesDeVerification,
): Promise<CompteRendu> {
  const { travailId, pieceId } = travail;
  const debut = Date.now();
  noterLObjet({ piece: pieceId });
  const aFaire = await api.rpc<VerificationAFaire>("capture", "verificationAFaire", [travailId]);
  if (aFaire.pieceId !== pieceId) {
    throw new Error(`vérification : le travail ${travailId} ne vise pas la pièce ${pieceId}`);
  }
  if (aFaire.abstention) return { motif: `relecture.abstention.${aFaire.abstention}` };

  const config = lireLaConfiguration(
    await api.rpc<unknown>("capture", "configurationRelectureCiblee", []),
  );
  if (!config.actif) return { motif: "relecture.abstention.coupee" };
  const nonRelue = (raison: string, detail: Record<string, unknown> = {}): CompteRendu => ({
    motif: `verification.non_relue.${raison}`,
    detail: { ms: Date.now() - debut, ...detail },
  });
  if (!config.modele || !config.consigne || !config.tarife) return nonRelue("modele_sans_tarif");
  if (!config.budget) return nonRelue("sans_budget");
  if (config.budget.epuise) return nonRelue("budget_epuise");
  const cle = "cle" in dep ? dep.cle : process.env["ANTHROPIC_API_KEY"];
  if (!dep.appeler && !cle?.trim()) return nonRelue("indisponible");

  const plan = aFaire.consigne.plan;
  const cases = casesARelire(plan, config.casesMax);
  if (cases.length === 0) {
    return {
      motif: "verification.non_prouvee",
      detail: { ms: Date.now() - debut, code: "ne_ferme_pas", kase: null },
    };
  }

  const { contexte, parametres, sudoku, construire } = await (dep.preparer ?? preparer)(
    api,
    pieceId,
    LECTEURS,
  );
  const image = await imageDeLaPage(parametres.bytes, parametres.mime);
  if (!image) return nonRelue("sans_image");

  const t0 = Date.now();
  const decoupees = await decouper(image, cases);
  const decoupeMs = Date.now() - t0;

  const modele = config.modele;
  const consigne = config.consigne;
  const appeler =
    dep.appeler ??
    ((corps: unknown) =>
      envoyerAClaude<ReponseBrute>({
        apiKey: cle,
        corps,
        signal: AbortSignal.timeout(DELAI_D_UN_APPEL_MS),
      }));
  const t1 = Date.now();
  const reponses = await Promise.allSettled(
    enLots(decoupees, config.lot).map((lot) => appeler(corpsDeLaRequete(modele, consigne, lot))),
  );
  const appelMs = Date.now() - t1;
  await journaliserLesAppels(api, contexte.piece.tenantId, pieceId, modele, reponses);

  const relues = reponses.flatMap((r) =>
    r.status === "fulfilled" ? lireLaReponse(r.value.reponse) : [],
  );
  if (reponses.every((r) => r.status === "rejected")) {
    return nonRelue("indisponible", { appelMs });
  }

  const t2 = Date.now();
  const { plan: candidat, changements } = planCandidat(plan, decoupees, relues);
  const selection = changements.length > 0 ? await sudoku.sansIa(candidat) : null;
  const repreuveMs = Date.now() - t2;
  const mesures = {
    cases: decoupees.length,
    illisibles: relues.filter((r) => !r.lisible).length,
    changees: changements.length,
    decoupeMs,
    appelMs,
    repreuveMs,
  };
  if (!selection) {
    return {
      motif: "verification.non_prouvee",
      detail: { ...motifDeNonPreuve(plan, decoupees, relues), ...mesures, ms: Date.now() - debut },
    };
  }

  /*
   * PROUVÉE : la lecture nouvelle est celle du Sudoku d'abord, sur le plan candidat — la
   * sélection est la preuve, aucun modèle n'a désigné. Le plan persisté est le candidat :
   * chaque montant cite le jeton relu, et c'est le jeton qui porte la valeur (R2).
   */
  const lue: VisionRead = {
    tokens: candidat,
    selection,
    lecteur: aFaire.consigne.lecteur as Lecteur,
    paddleTente: aFaire.consigne.paddleTente,
    model: `${aFaire.mode ?? aFaire.consigne.lecteur}+${MODELE_SUDOKU}`,
    readModel: aFaire.mode ?? aFaire.consigne.lecteur,
    selectModel: MODELE_SUDOKU,
    selectRole: ROLE_SUDOKU,
    latencyMs: Date.now() - debut,
    tokensIn: null,
    tokensOut: null,
    releve: { latencyMs: 0, tokensIn: null, tokensOut: null },
    designation: { latencyMs: repreuveMs, tokensIn: null, tokensOut: null },
    prouveeSansIa: true,
  };
  const lecture = await sudoku.lire(lue);
  const construite = construire(lecture);
  const { lecture: aPersister } = lectureAPersister(pieceId, contexte.packId, lecture, construite);
  try {
    await api.rpc<{ extractionId: string | null }>("capture", "persisterRelecture", [
      { ...aPersister, travailId },
    ]);
  } catch (e: unknown) {
    // Une personne a corrigé la pièce PENDANT la vérification : sa correction l'emporte.
    if (e instanceof Error && e.message.includes("refus.relecture.corrigee")) {
      return { motif: "relecture.abstention.correction_humaine", detail: mesures };
    }
    throw e;
  }
  await sudoku.inscrire(lecture);
  await api.rpc<{ verdict: string }>("capture", "analyser", [pieceId]);
  return { motif: "verification.prouvee", detail: { ...mesures, ms: Date.now() - debut } };
}

interface LigneDuJournal {
  agent: string;
  role: string;
  status: "ok" | "error";
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  erreur: string | null;
}

/**
 * Chaque appel au journal, à son tarif : entrée et sortie (rôle `chat`), puis le cache de
 * la consigne, lu et écrit (rôles `cache`, `cache_ecriture`) sous un agent à part. Un appel
 * en panne a sa ligne d'erreur, sans jetons. Un échec de journalisation se crie, il ne
 * prive pas la pièce de sa vérification.
 */
async function journaliserLesAppels(
  api: AppelApi,
  tenantId: string,
  pieceId: string,
  modele: string,
  reponses: ReadonlyArray<PromiseSettledResult<{ reponse: ReponseBrute; latencyMs: number }>>,
): Promise<void> {
  const lignes = reponses.flatMap((r): LigneDuJournal[] => {
    if (r.status === "rejected") {
      const raison = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return [
        {
          agent: AGENT,
          role: "chat",
          status: "error",
          latencyMs: 0,
          tokensIn: null,
          tokensOut: null,
          erreur: `panne: ${raison.replace(/\s+/gu, " ").slice(0, 200)}`,
        },
      ];
    }
    const u = r.value.reponse.usage ?? {};
    return [
      {
        agent: AGENT,
        role: "chat",
        status: "ok",
        latencyMs: r.value.latencyMs,
        tokensIn: u.input_tokens ?? null,
        tokensOut: u.output_tokens ?? null,
        erreur: null,
      },
      ...(
        [
          ["cache", u.cache_read_input_tokens ?? 0],
          ["cache_ecriture", u.cache_creation_input_tokens ?? 0],
        ] as const
      )
        .filter(([, n]) => n > 0)
        .map(([role, n]): LigneDuJournal => ({
          agent: `${AGENT}.cache`,
          role,
          status: "ok",
          latencyMs: 0,
          tokensIn: n,
          tokensOut: null,
          erreur: null,
        })),
    ];
  });
  await Promise.all(
    lignes.map((l) =>
      api
        .rpc<string | null>("capture", "journaliserAgent", [
          { tenantId, model: modele, pieceId, ...l },
        ])
        .catch((e: unknown) => {
          console.error(
            `coût NON journalisé — agent ${l.agent}, modèle ${modele}, rôle ${l.role} : ${
              e instanceof Error ? e.message.slice(0, 200) : String(e)
            }`,
          );
        }),
    ),
  );
}
