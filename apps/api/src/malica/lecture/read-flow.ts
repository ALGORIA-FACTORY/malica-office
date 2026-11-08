/**
 * Orchestration de la lecture citée d'une pièce.
 * Le cerveau : télécharge la pièce, appelle l'œil (deux passes), passe la
 * sortie au filtre du plan de tokens, persiste par RPC gouvernée.
 * Aucun montant ne sort d'ici sans son token d'origine.
 *
 * Le transport a changé — l'API au lieu de PostgREST, la route de contenu au
 * lieu du stockage de l'ancien fournisseur — et rien d'autre. Les deux passes,
 * le plan de tokens et la désignation sont exactement ceux d'avant.
 *
 * Un détail qui n'en est pas un : les taux et les charges arrivent de l'API
 * avec le même type qu'ils avaient de PostgREST — des nombres — et sont remis
 * en chaîne ici de la même façon. « 19 » et « 19.0000 » ne sont pas la même
 * invite, et ce fichier compose une invite.
 */

import type { DeviseLue } from "@malica/socle/montant-imprime";

import type { AppelApi } from "../appel-local.ts";

import { traceDOrigineDeLaPiece } from "../../db.ts";
import type { CompteRendu } from "../../fabrique/travaux-execution.ts";
import { consigner, tracerUnTravail } from "../../observabilite/journal.ts";
import { noterLObjet } from "../../observabilite/trace.ts";
import { confianceParChamp } from "../../scan/confiance.ts";

import {
  raisonDuRattrapage,
  tracerLaPersistance,
  tracerLeRattrapage,
  tracerLeSudoku,
  tracerLExtraction,
  tracerLOcr,
  type Passe,
  type RaisonDuRattrapage,
} from "./etapes-de-lecture.ts";
import { erreurAuJournal, lireLaChaine } from "./designation.ts";
import { creerDesignateurDeRecette } from "./par-recette.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { ReglesDeLecture } from "./regles-de-lecture.ts";
import { secondLecteurDisponible } from "./paddle.ts";
import { creerLeSudoku } from "./sudoku.ts";
import { runVisionRead, type VisionRead } from "./vision.ts";
import type { LectureDePiece } from "@malica/socle/ports/malica";

interface ContexteLecture {
  piece: {
    id: string;
    tenantId: string;
    source: string;
    contentType: string | null;
    /** Le jour de réception (`AAAA-MM-JJ`). */
    recueLe: string;
    /** Le sens confirmé par la personne (`sensConfirme`), s'il l'est. */
    sens?: "achat" | "vente";
  };
  packId: string;
  /** La devise du dossier. */
  currency: string;
  /** Toutes les devises du référentiel, pour lire les montants de la pièce. */
  devises: DeviseLue[];
  /** Les règles de lecture du pack au jour de réception (`lireLesReglesDeLecture`). */
  regles: ReglesDeLecture;
  dossier: { raisonSociale: string; identifiantFiscal: string | null };
  taxCodes: Array<{ code: string; label: string; rate: number }>;
  chargeCodes: Array<{ code: string; label: string }>;
  tiers: Array<{
    code: string;
    raisonSociale: string;
    nature: string;
    identifiantFiscal: string | null;
  }>;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

/**
 * La base a refusé la lecture. Le motif est celui de `lecture_autorisee`, tel
 * quel : ses libellés vivent au référentiel (R4), jamais ici.
 */
export class LectureRefusee extends Error {
  readonly motif: string;
  constructor(motif: string) {
    super(motif);
    this.name = "LectureRefusee";
    this.motif = motif;
  }
}

/**
 * Les deux organes payants. Injectables pour qu'une épreuve prouve que le
 * refus arrête la chaîne AVANT eux ; en service, ce sont toujours les vrais.
 */
interface Lecteurs {
  lire: typeof runVisionRead;
  secondLecteurDisponible: () => boolean;
}

const LECTEURS: Lecteurs = { lire: runVisionRead, secondLecteurDisponible };

/*
 * La qualite d'une lecture, en preuves et non en impression : le contrat
 * rempli vaut 2, des montants qui tiennent valent 1. Trois, c'est une
 * lecture qu'aucun rattrapage ne peut ameliorer.
 */
const QUALITE_PARFAITE = 3;
/**
 * Une relecture de nuit est-elle retenue ? STRICTEMENT meilleure en qualité ; ou, à
 * qualité égale, demandée pour ses lignes et les ayant fait PROUVER par le moteur
 * (5 novembre 2026). Jamais moins bonne, quoi qu'en disent ses lignes.
 */
export function relectureRetenue(avant: number, apres: number, lignesProuvees: boolean): boolean {
  return apres > avant || (apres === avant && lignesProuvees);
}

export function qualiteDeLecture(b: {
  contract: string;
  flags: ReadonlyArray<{ code: string }>;
}): number {
  const complet = b.contract === "extract.v1" ? 2 : 0;
  const coherent = b.flags.some((f) => f.code === "ARITHMETIQUE_INCOHERENTE") ? 0 : 1;
  return complet + coherent;
}

/**
 * Le lecteur du rattrapage : toujours un AUTRE que celui qui vient de lire.
 *
 * - la couche de texte d'un PDF → ses images (PDF hybride) ;
 * - PaddleOCR → le modele de vision ;
 * - le modele de vision → PaddleOCR, seulement s'il n'a pas deja ete essaye
 *   sur cette piece (absent, coupe-circuit) et qu'il est la : sinon on
 *   repaierait un appel pour la meme reponse.
 */
export function autreLecteur(
  premiere: Pick<VisionRead, "lecteur" | "paddleTente">,
  paddleDisponible: boolean,
): { sansPaddle?: boolean; sansCoucheTexte?: boolean } | null {
  if (premiere.lecteur === "pdf-text") return { sansCoucheTexte: true };
  if (premiere.lecteur === "paddle") return { sansPaddle: true };
  if (premiere.lecteur === "vision" && !premiere.paddleTente && paddleDisponible) return {};
  return null;
}

/**
 * Tout ce qu'une lecture prépare avant d'appeler un lecteur : le contexte de
 * la pièce, ses octets, les paramètres du lecteur, la relecture dans le plan
 * (`construire`) et le sudoku. La première lecture et la relecture de nuit
 * lisent la même pièce, dans le même dossier : elles partagent ceci, à
 * l'instruction près.
 */
async function preparer(api: AppelApi, pieceId: string, lecteurs: Lecteurs) {
  // La pièce, son organisation, le pack en vigueur, les taux et les charges :
  // un appel là où il en fallait cinq, mêmes requêtes côté base.
  const contexte = await api.rpc<ContexteLecture>("capture", "contexteLecture", [pieceId]);
  noterLObjet({ tenant: contexte.piece.tenantId, piece: pieceId });

  const fichier = await api.contenu(pieceId);
  const bytes = fichier.octets;
  // Le type vient de la base. L'ancien flux le tenait du Blob rendu par le
  // stockage, avec le même repli lorsqu'il était vide.
  const mime = contexte.piece.contentType || fichier.type || "image/jpeg";
  const dataUrl = `data:${mime};base64,${toBase64(bytes)}`;

  const chargeCodes = Array.from(
    new Map(contexte.chargeCodes.map((c) => [c.code, { code: c.code, label: c.label }])).values(),
  );

  /*
   * ======================================= LA FABRIQUE DE LECTEURS, BRANCHÉE
   *
   * Un seul point d'insertion, et il est dans `vision.ts` : entre le plan de
   * jetons et la désignation. Ce fichier ne fournit que ce que la fabrique ne
   * peut pas deviner — la pièce, son organisation, la devise du dossier — et
   * ce qu'elle rend est un `VisionSelection`. Tout ce qui suit, ici, est donc
   * inchangé à l'instruction près.
   *
   * Sans recette applicable, le désignateur rend `null` et la passe 2 part
   * comme avant. La non-régression est structurelle : il n'y a rien à
   * désactiver.
   */
  const parRecette = creerDesignateurDeRecette(api, {
    pieceId,
    tenantId: contexte.piece.tenantId,
  });

  // Les paramètres de lecture ne s'écrivent qu'une fois : la première lecture
  // et le rattrapage lisent la même pièce, dans le même dossier.
  const parametres = {
    parRecette,
    /*
     * La chaîne de désignation (Claude, puis DeepSeek, puis l'arrêt), relue
     * en base à CHAQUE désignation : un budget atteint par une autre pièce
     * entre-temps fait basculer celle-ci. La base décide, ce fichier appelle.
     */
    designation: {
      chaine: async () =>
        lireLaChaine(await api.rpc<unknown>("capture", "chaineDeDesignation", [])),
    },
    dataUrl,
    mime,
    // Les octets bruts servent au PDF : sa couche de texte se lit sans modèle.
    bytes,
    chargeCodes,
    // Les tiers du dossier : l'œil doit reconnaître un fournisseur déjà
    // enregistré au lieu de le relire comme un inconnu à chaque facture.
    tiers: contexte.tiers,
    dossier: contexte.dossier,
    taxCodes: contexte.taxCodes.map((r) => ({
      code: r.code,
      label: r.label,
      // `String(nombre)` : exactement ce que faisait `String(r.rate)` sur la
      // valeur JSON rendue par PostgREST.
      rate: String(r.rate),
    })),
  };
  const construire = (lecture: VisionRead) =>
    buildExtractFromTokenPlan({
      tokens: lecture.tokens,
      selection: lecture.selection,
      // Les devises du référentiel (`lireLesDevises`) et celle du dossier :
      // la relecture décide de celle de la PIÈCE (`deviseDeLaPiece`), comme
      // le jugement, et lit ses montants avec son exposant et son séparateur.
      devises: contexte.devises,
      deviseDuDossier: contexte.currency,
      // Le matricule de la fiche : c'est lui qui DÉDUIT le sens de la pièce, au
      // lieu de croire ce que le modèle en dit.
      matriculeDossier: contexte.dossier.identifiantFiscal,
      // La convention de date et la forme du matricule : celles du pack (R4).
      regles: contexte.regles,
      // Le lecteur décide des chiffres orientaux (`litLesChiffresOrientaux`).
      lecteur: lecture.lecteur,
    });

  /*
   * ================================================== LE SUDOKU, APRÈS LA DÉSIGNATION
   *
   * Chaque lecture — la première comme le rattrapage — passe par le sudoku.
   * Par défaut il OBSERVE : il inscrit ce qu'il a lu, et la lecture de la
   * chaîne ressort à l'identique. Branché par le réglage du dossier
   * (`lecture.sudoku` = `designe`, « Réglages comptabilité »), la désignation
   * PROUVÉE remplace celle de la chaîne pour les totaux, les lignes de TVA et
   * les droits. Il rend un `VisionRead` : tout l'aval — relecture dans le
   * plan, contrôles, persistance — est celui d'avant. Voir `sudoku.ts`.
   */
  const sudoku = creerLeSudoku(api, {
    pieceId,
    dossierId: contexte.piece.tenantId,
    packId: contexte.packId,
    recueLe: contexte.piece.recueLe,
    dates: contexte.regles.dates,
    devise: contexte.devises.find((d) => d.code === contexte.currency),
    dossier: {
      matricule: contexte.dossier.identifiantFiscal,
      raisonSociale: contexte.dossier.raisonSociale,
    },
    tiers: contexte.tiers,
    ...(contexte.piece.sens ? { sens: contexte.piece.sens } : {}),
  });
  const decimalesDe = (lu: Construite) =>
    (
      contexte.devises.find((d) => d.code === lu.extract["currency"]) ??
      contexte.devises.find((d) => d.code === contexte.currency)
    )?.decimales ?? 0;

  /*
   * Une passe de lecture, et ses trois étapes au journal (`etapes-de-lecture.ts`) :
   * l'appel au lecteur, ce que sa désignation PROPOSE une fois relue dans le
   * plan, puis le verdict du sudoku et son écart. Ce qui sort est la lecture
   * rendue par le sudoku — désignée par la preuve, ou telle quelle — et sa
   * relecture dans le plan, qui fait foi pour la suite.
   */
  const lire = async (p: Parameters<Lecteurs["lire"]>[0], passe: Passe) => {
    const brute = await tracerLOcr(pieceId, passe, () => lecteurs.lire(p));
    const lecture = await sudoku.lire(brute);
    const proposee = construire(brute);
    const decimales = decimalesDe(proposee);
    tracerLExtraction(pieceId, passe, proposee, qualiteDeLecture(proposee), decimales);
    tracerLeSudoku(pieceId, passe, sudoku.verdict(lecture), proposee, decimales);
    return { lecture, construite: lecture === brute ? proposee : construire(lecture) };
  };
  return { contexte, parametres, sudoku, lire, decimalesDe };
}

export async function readPieceFlow(
  api: AppelApi,
  pieceId: string,
  lecteurs: Lecteurs = LECTEURS,
): Promise<LectureDePiece> {
  /*
   * ================================ LE COMPTEUR : DEUX TEMPS, ET L'ORDRE EST LA RÈGLE
   *
   * 1. ICI, avant tout appel payant : la base dit si cette lecture est permise.
   *    Faux, on s'arrête avec le motif de la base. Le plafond se vérifie UNE
   *    fois : une pièce commencée se termine, rattrapage compris.
   * 2. TOUT EN BAS, juste avant de rendre : `lecture_consommer`. Une lecture qui
   *    lève — modèle indisponible, citation refusée, persistance refusée — ne
   *    se facture pas, parce que la personne n'a rien reçu.
   *
   * Ce fichier ne porte ni seuil, ni compteur, ni libellé : il appelle, la base
   * décide (R3, R4). Une pièce lue compte UNE lecture, rattrapage compris.
   */
  noterLObjet({ piece: pieceId });
  const verdict = await api.rpc<{ autorisee: boolean; motif: string }>(
    "capture",
    "lectureAutorisee",
    [pieceId],
  );
  if (!verdict.autorisee) {
    // Refusée AVANT tout appel payant : l'étape du lecteur le dit, avec le motif de la base.
    consigner("ocr", "refus", {
      cle: `${pieceId}:premiere`,
      piece: pieceId,
      detail: { passe: "premiere", motif: verdict.motif },
    });
    /*
     * Le refus s'INSCRIT : la lecture d'arrière-plan lancée par la file hors
     * ligne n'a personne à qui répondre, et un refus qui ne s'écrit nulle part
     * est un silence — indistinguable d'une panne. La base rejoue le verdict et
     * inscrit son propre motif (code). Si l'inscription échoue, on le crie :
     * la lecture reste refusée, mais l'échec ne se tait pas.
     */
    await api.rpc("capture", "inscrireRefusDeLecture", [pieceId]).catch((e: unknown) => {
      console.error(
        `refus de lecture NON inscrit — pièce ${pieceId}, motif ${verdict.motif} : ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    });
    throw new LectureRefusee(verdict.motif);
  }

  const { contexte, parametres, sudoku, lire, decimalesDe } = await preparer(
    api,
    pieceId,
    lecteurs,
  );

  const premiere = await lire(parametres, "premiere");
  const premiereLecture = premiere.lecture;
  let read = premiereLecture;
  let built = premiere.construite;

  /*
   * ================================= DEUX LECTEURS, ET LE SECOND RATTRAPE LE PREMIER
   *
   * 14 octobre 2026, a la demande du dirigeant : « garder les deux, Paddle en
   * premiere couche et l'OCR en seconde ». L'ordre : la couche de texte d'un
   * PDF (exacte, gratuite), puis PaddleOCR, puis le modele de vision.
   *
   * LE DECLENCHEUR EST UNE PREUVE, PAS UN SEUIL. Deux preuves, depuis le
   * 24 octobre 2026 : le contrat sort partiel (le schema n'est pas rempli),
   * OU les montants ne tiennent pas (`ARITHMETIQUE_INCOHERENTE` : HT + TVA +
   * droits ne donnent pas le TTC imprime). La seconde n'en declenchait aucun :
   * une lecture complete mais fausse restait telle quelle, avec un drapeau.
   *
   * ON NE GARDE LA SECONDE QUE SI ELLE FAIT STRICTEMENT MIEUX. A egalite, la
   * premiere gagne : on ne remplace pas un defaut connu par un defaut inconnu.
   *
   * ON NE RELIT JAMAIS AVEC LE LECTEUR QUI VIENT DE LIRE (`autreLecteur`).
   */
  /*
   * ====================================== UNE PIÈCE PROUVÉE NE SE RATTRAPE PAS
   *
   * Mesuré sur le staging le 1er novembre 2026 : 4,6 s de lecture, puis 17 s
   * de rattrapage par le modèle de vision, déclenché parce que le contrat sort
   * « partiel » (des prix TTC unitaires qu'aucune facture n'imprime), et dont
   * la lecture était écartée. Quand le sudoku a DÉSIGNÉ la pièce (réglage
   * `lecture.sudoku` = `designe`, pièce prouvée), ses totaux tiennent par
   * preuve : un second lecteur ne peut pas faire mieux sur eux. En
   * observation, rien ne change.
   */
  const autre = autreLecteur(premiereLecture, lecteurs.secondLecteurDisponible());
  const qualiteAvant = qualiteDeLecture(built);
  const raison = raisonDuRattrapage(
    built,
    qualiteAvant >= QUALITE_PARFAITE,
    autre !== null,
    sudoku.prouvee(premiereLecture),
  );
  /*
   * Une lecture ARRÊTÉE faute de budget ne se rattrape pas : un second lecteur
   * se paierait, et sa désignation s'arrêterait au même endroit.
   */
  const aRattraper =
    qualiteAvant < QUALITE_PARFAITE &&
    autre !== null &&
    !sudoku.prouvee(premiereLecture) &&
    premiereLecture.sansModele === undefined;
  /*
   * ======================================== LA RELECTURE DE NUIT (17 novembre 2026)
   *
   * Mesuré sur le staging le 1er novembre 2026 : 19,4 s médianes par lecture,
   * dont 13 à 15 s de rattrapage, le plus souvent écarté. Le dirigeant a
   * décidé que la lecture lourde passe en différé : « la nuit, si ni le client
   * ni le cabinet n'a corrigé ». Réglage du dossier, `lecture.relecture_nuit` :
   *
   *   coupee (défaut)  rien ne change, le rattrapage part ici, tout de suite ;
   *   active           la première lecture est persistée et rendue ; la même
   *                    relecture — même déclencheur, même autre lecteur — est
   *                    INSCRITE dans la file, pas avant la lecture + le délai
   *                    (`relirePiece`, que le coureur exécute).
   *
   * La base répond (`app.relecture_de_nuit`), et on ne la questionne que si le
   * rattrapage partirait : une lecture parfaite ne coûte pas un appel de plus.
   * Si elle ne peut pas répondre, on le crie et on rattrape comme avant —
   * c'est le comportement du réglage coupé, pas une valeur devinée.
   */
  /*
   * ========================================= LES LIGNES À VÉRIFIER (5 novembre 2026)
   *
   * Décision du dirigeant : les lignes qu'aucune somme ne prouve se montrent « lu, non
   * vérifié » le jour ; la NUIT les reprend, avec l'autre lecteur, et le moteur les prouve
   * au matin. Jamais en journée : ce n'est pas un rattrapage synchrone.
   */
  const lignesARelire = autre !== null && sudoku.lignes(premiereLecture) === "a_verifier";
  const differee = aRattraper || lignesARelire ? await relectureDeNuitActive(api, pieceId) : false;
  const rattrapage = {
    declenche: aRattraper && !differee,
    raison,
    differe: differee,
    qualiteAvant,
  };
  if (!rattrapage.declenche) tracerLeRattrapage(pieceId, "rattrapage", rattrapage);
  if (aRattraper && !differee) {
    /*
     * ============== UN ECHEC AU RATTRAPAGE NE DETRUIT PAS CE QU'ON TIENT DEJA
     *
     * Quelle que soit l'erreur : cle absente, quota, reponse tronquee, PDF
     * sans image. Seules les pannes de fournisseur etaient epargnees ; une
     * erreur du modele de vision au rattrapage faisait donc echouer TOUTE la
     * lecture, et la premiere — partielle mais reelle — etait perdue (audit
     * du 24 octobre 2026). La premiere lecture existe : c'est elle qui sort.
     */
    try {
      const seconde = await lire({ ...parametres, ...autre }, "rattrapage");
      const qualiteApres = qualiteDeLecture(seconde.construite);
      const retenue = qualiteApres > qualiteAvant;
      tracerLeRattrapage(pieceId, "rattrapage", rattrapage, {
        qualiteApres,
        retenue,
        lecteur: seconde.lecture.lecteur,
      });
      if (retenue) {
        read = seconde.lecture;
        built = seconde.construite;
      }
    } catch (e: unknown) {
      tracerLeRattrapage(pieceId, "rattrapage", rattrapage, { erreur: e });
      console.error(
        `[lecture] rattrapage impossible — pièce ${pieceId} : ${
          e instanceof Error ? e.message : String(e)
        } ; la première lecture est conservée`,
      );
    }
  }

  const { lecture: aPersister, flags } = lectureAPersister(pieceId, contexte.packId, read, built);
  await tracerLaPersistance(pieceId, "premiere", built, decimalesDe(built), () =>
    api.rpc<{ extractionId: string | null }>("capture", "persisterLecture", [aPersister]),
  );

  // Les champs du sudoku, pour la lecture RETENUE seulement, et une fois son
  // plan de jetons persisté : leurs citations pointent dans ce plan-là.
  await sudoku.inscrire(read);

  /*
   * La relecture s'inscrit APRÈS la lecture qu'elle relit : la base en tire
   * l'heure (la lecture + le délai) et l'identité de la lecture à relire. Un
   * échec ne prive pas la personne de sa lecture — elle est persistée — mais
   * il se crie : une relecture promise et jamais inscrite est un silence.
   */
  if (differee) {
    await api
      .rpc("capture", "inscrireRelecture", [
        pieceId,
        {
          lecteur: premiereLecture.lecteur,
          paddleTente: premiereLecture.paddleTente,
          ...(lignesARelire ? { lignes: true } : {}),
        },
      ])
      .catch((e: unknown) => {
        console.error(
          `[lecture] relecture de nuit NON inscrite — pièce ${pieceId} : ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
  }

  const journal = await journaliser(api, contexte.piece.tenantId, pieceId, read);

  // La pièce se juge sur ce que la base porte désormais.
  const analyse = await api.rpc<{ verdict: string }>("capture", "analyser", [pieceId]);

  /*
   * Le deuxième temps du compteur, et le dernier geste avant de rendre : la
   * base porte le résultat, l'analyse a abouti, rien ne peut plus lever que
   * le comptage lui-même. Ni plus tôt (une lecture qui échoue ne se facture
   * pas), ni plus d'une fois (la base ne compte jamais deux fois une pièce).
   *
   * ============================== UN DÉPASSEMENT À LA FRONTIÈRE EST ACCEPTÉ
   *
   * Le contrôle (en tête) et le comptage (ici) ne sont pas atomiques : deux
   * pièces lues en parallèle à 64/65 passent toutes deux la porte ; deux
   * instances du serveur peuvent lire la même pièce deux fois (le registre
   * des lectures en cours est en mémoire de processus) ; un processus qui
   * meurt entre la persistance et le comptage offre la lecture.
   *
   * Les fermer exigerait de RÉSERVER la lecture avant d'en connaître le
   * résultat — donc de facturer un échec, ce que la règle de ce fichier
   * interdit. Arbitrage : un dépassement d'une ou deux lectures à la
   * frontière du forfait plutôt qu'un client facturé pour une lecture qu'il
   * n'a pas reçue. C'est un arbitrage de prix, écrit au dossier de la
   * livraison. Ne pas « corriger » ce trou en réservant en tête.
   *
   * Si ce comptage échoue — plafond atteint entre-temps par une AUTRE pièce lue
   * en parallèle —, l'erreur remonte : on ne rend pas gratuitement ce que la
   * base a refusé de compter. Ce n'est pas silencieux, et c'est à la base de
   * dire non.
   */
  await api.rpc("capture", "consommerLecture", [pieceId]);

  return {
    pieceId,
    contract: built.contract,
    citations: built.citations.length,
    flags,
    valid: built.valid,
    model: read.model,
    latencyMs: read.latencyMs,
    tokensIn: read.tokensIn,
    tokensOut: read.tokensOut,
    verdict: analyse.verdict,
    journal,
  };
}

/** Ce que `readPieceFlow` construit d'une lecture (`buildExtractFromTokenPlan`). */
type Construite = ReturnType<typeof buildExtractFromTokenPlan>;

/**
 * La lecture telle que la base la persiste, et ses drapeaux — la première
 * comme une relecture retenue : un seul endroit pour le dire.
 */
function lectureAPersister(pieceId: string, packId: string, read: VisionRead, built: Construite) {
  // Projection des articles cités pour l'analyse par famille (PME).
  // La famille est résolue par le pack (compte, puis motif de désignation) —
  // aucune famille en dur ici, et aucun article sans citation persistée.
  const extract = built.extract as {
    document_kind?: string | null;
    document_date?: string | null;
    articles?: Array<Record<string, string | null>>;
  };

  // La lecture et ses articles partent ensemble : côté API, une seule
  // transaction. Une lecture persistée sans ses articles n'existe plus.
  // Un sens indéterminé n'est pas une lecture ratée : c'est une question
  // posée à la personne. On la marque pour que l'écran la pose.
  const flags = extract.document_kind
    ? built.flags
    : [...built.flags, { field: "document_kind", code: "direction.incertaine" }];

  return {
    flags,
    lecture: {
      pieceId,
      packId,
      tokens: read.tokens,
      contract: built.contract,
      extract: built.extract,
      citations: built.citations,
      flags,
      articles: extract.articles ?? [],
      documentKind: extract.document_kind ?? null,
      /*
       * Une date NON LUE vaut `null`, jamais la chaîne vide.
       *
       * `??` ne retient que `null` et `undefined` : une chaîne vide passait au
       * travers et arrivait à Postgres en `''::date`, qui refuse. Toute la
       * persistance de la lecture échouait alors — pour un champ absent.
       */
      documentDate: extract.document_date?.trim() ? extract.document_date : null,
      // Comment la pièce a été relevée, et la confiance de chaque champ lu :
      // posées avec la lecture, qui est immuable (R7).
      mode: read.readModel,
      confianceParChamp: confianceParChamp(
        built.citations as Array<{ field: string; page: number; ordinal: number }>,
        read.tokens,
        read.selection.overall_confidence,
      ),
    },
  };
}

/*
 * Le journal des exécutions : une ligne par organe, chacune à son tarif.
 *
 * Un organe sans tarif en vigueur ne se journalise pas : `agents_run_log`
 * refuse d'écrire un coût sans origine, et c'est juste.
 *
 * ================================================= CE QUI A ÉTÉ CORRIGÉ ICI
 *
 * Le commentaire précédent affirmait que le prix de Qwen-VL-OCR « n'a pas été
 * relevé ». Il était périmé : le tarif est en base depuis le 4 octobre 2026.
 *
 * Et surtout, l'échec ne partait QUE dans le champ `journal` de la réponse,
 * que rien ne lit. Résultat, mesuré le 5 octobre : zéro ligne de relevé dans
 * `agents.agent_runs`, et personne ne le savait. La cause était banale — les
 * deux pièces d'essai ont été lues à 14:47:40, et la migration du tarif
 * appliquée à 15:00:22, treize minutes trop tard — mais c'est l'INVISIBILITÉ
 * qui a coûté : sans coût journalisé, le plafond de `agents.budgets` ne mord
 * sur rien.
 *
 * Un échec de journalisation crie donc maintenant dans le journal du serveur.
 * Il ne fait toujours pas échouer la lecture : la pièce est lue, et une
 * dépense non mesurée ne doit pas priver la personne de son résultat.
 */
/** Une ligne du journal des exécutions (`agents_run_log`), avant son envoi. */
interface EntreeDuJournal {
  agent: string;
  model: string;
  role: string;
  passe: { latencyMs: number; tokensIn: number | null; tokensOut: number | null };
  status: "ok" | "degraded" | "error";
  erreur: string | null;
}

/** Ce qu'une lecture inscrit au journal : le relevé, la désignation, chaque bascule. */
export function entreesDuJournal(read: VisionRead): EntreeDuJournal[] {
  const [releve, designation] = (
    [
      ["malica.lecture.releve", read.readModel, "vision", read.releve],
      // Le role vient de la MEME source que le modele : voir `selectRole`.
      ["malica.lecture.designation", read.selectModel, read.selectRole, read.designation],
    ] as const
  ).map(([agent, model, role, passe]) => ({
    agent,
    model,
    role,
    passe,
    status: "ok" as EntreeDuJournal["status"],
    erreur: null as string | null,
  }));
  /*
   * ======================================= LA CHAÎNE DE DÉSIGNATION AU JOURNAL
   *
   * Un repli a désigné : sa ligne dit `degraded`, et le motif de la première
   * bascule. Chaque maillon sauté a SA ligne, sous son propre couple (modèle,
   * rôle), sans jetons — donc à coût nul —, avec son motif. Un arrêt n'a pas
   * de ligne de désignation (aucun modèle n'a désigné) : ses maillons disent
   * `arret.budgets_epuises`. La tour lit ces lignes (`designation_etat`).
   */
  const bascules = read.bascules ?? [];
  const premiere = bascules[0];
  if (premiere && designation) {
    designation.status = "degraded";
    designation.erreur = `repli.${premiere.motif}`;
  }
  /*
   * Le cache du prompt système de Claude se facture à part : sa lecture et
   * son écriture ont chacune leur ligne, sous leur rôle tarifé (`cache`,
   * `cache_ecriture`), pour que le plafond morde sur la facture exacte.
   */
  const cache = read.sansModele === undefined ? read.designation.cache : undefined;
  const lignesDuCache = (
    [
      ["cache", cache?.lus ?? 0],
      ["cache_ecriture", cache?.ecrits ?? 0],
    ] as const
  )
    .filter(([, n]) => n > 0 && designation)
    .map(([role, n]) => ({
      agent: designation?.agent ?? "",
      model: read.selectModel,
      role,
      passe: { latencyMs: 0, tokensIn: n, tokensOut: null },
      status: "ok" as const,
      erreur: null,
    }));
  return [
    ...(releve ? [releve] : []),
    ...(designation && read.sansModele === undefined ? [designation] : []),
    ...lignesDuCache,
    ...bascules.map((b) => ({
      agent: designation?.agent ?? "",
      model: b.modele,
      role: b.role,
      passe: { latencyMs: 0, tokensIn: null, tokensOut: null },
      status: "error" as const,
      erreur: erreurAuJournal(b, read.sansModele ?? null),
    })),
  ];
}

async function journaliser(api: AppelApi, tenantId: string, pieceId: string, read: VisionRead) {
  const entrees = entreesDuJournal(read);
  return Promise.all(
    entrees.map(({ agent, model, role, passe, status, erreur }) =>
      api
        .rpc<string | null>("capture", "journaliserAgent", [
          {
            tenantId,
            agent,
            model,
            role,
            status,
            latencyMs: passe.latencyMs,
            tokensIn: passe.tokensIn,
            tokensOut: passe.tokensOut,
            pieceId,
            erreur,
          },
        ])
        .then(
          () => ({ agent, model, journalise: true as const }),
          (e: unknown) => {
            const raison = e instanceof Error ? e.message.slice(0, 200) : String(e);
            // Fort, et non dans un champ que personne ne lit : une dépense non
            // mesurée est une dépense sans plafond.
            console.error(
              `coût NON journalisé — agent ${agent}, modèle ${model}, rôle ${role} : ${raison}`,
            );
            return { agent, model, journalise: false as const, raison };
          },
        ),
    ),
  );
}

/** La base dit si la relecture de nuit est active ; une réponse impossible se crie. */
async function relectureDeNuitActive(api: AppelApi, pieceId: string): Promise<boolean> {
  try {
    return await api.rpc<boolean>("capture", "relectureDeNuit", [pieceId]);
  } catch (e: unknown) {
    console.error(
      `[lecture] réglage de la relecture de nuit illisible — pièce ${pieceId} : ${
        e instanceof Error ? e.message : String(e)
      } ; le rattrapage part tout de suite`,
    );
    return false;
  }
}

/** Ce que `fabrique.relecture_a_faire` rend (dépôt `capture`, `relectureAFaire`). */
interface RelectureAFaire {
  pieceId: string;
  contract: string;
  flags: ReadonlyArray<{ code: string }>;
  /** `lignes` : la première lecture laissait des lignes à vérifier (5 novembre 2026). */
  consigne: Pick<VisionRead, "lecteur" | "paddleTente"> & { lignes?: boolean };
  abstention: string | null;
  trace: string | null;
}

/**
 * La relecture de nuit d'une pièce — un travail `relecture_piece` de la file,
 * exécuté par le coureur quand son heure est venue.
 *
 * ================================================================ L'ORDRE
 *
 * 1. AVANT tout appel payant, la base dit s'il faut s'abstenir : la pièce a
 *    été remplacée, une lecture plus récente fait foi, une PERSONNE l'a
 *    corrigée ou validée depuis (le client ou le cabinet : une précision, une
 *    écriture, une décision, un retour…), ou la relecture de nuit a été coupée
 *    entre-temps. S'abstenir n'est pas échouer : le travail se termine, et son
 *    motif le dit.
 * 2. L'AUTRE lecteur relit, et le sudoku repasse — exactement comme le
 *    rattrapage synchrone (`lire` = `sudoku.lire(lecteurs.lire(p))`).
 * 3. Le coût se journalise, que la relecture soit retenue ou non : le modèle a
 *    été payé, et une dépense non mesurée est une dépense sans plafond.
 * 4. Elle n'est retenue que si elle fait STRICTEMENT mieux (même règle qu'au
 *    rattrapage). Retenue, elle est persistée comme une lecture NOUVELLE, par
 *    sa porte (`capture_relecture_persist`), qui revérifie qu'aucune personne
 *    n'a corrigé la pièce pendant qu'on lisait ; puis la pièce se rejuge.
 *
 * Elle ne se décompte pas : « une pièce lue compte UNE lecture, rattrapage
 * compris », et la relecture est ce rattrapage, différé.
 */
export async function relirePiece(
  api: AppelApi,
  travail: { travailId: string; pieceId: string; tentative?: number },
  lecteurs: Lecteurs = LECTEURS,
): Promise<CompteRendu> {
  /*
   * Une trace ENFANT de l'opération qui a fait naître la pièce (sa capture) :
   * la chronologie de la pièce suit la relecture de nuit jusqu'à elle. La même
   * tentative rejouée retombe sur la même trace (`travailId`), sans doubler une
   * étape. Sans journal joignable, la relecture se fait quand même, sans parente.
   */
  const parente = await traceDOrigineDeLaPiece(travail.pieceId).catch(() => null);
  return tracerUnTravail("relecture_piece", parente, () => relire(api, travail, lecteurs), {
    travailId: travail.travailId,
    ...(travail.tentative === undefined ? {} : { tentative: travail.tentative }),
  });
}

async function relire(
  api: AppelApi,
  travail: { travailId: string; pieceId: string },
  lecteurs: Lecteurs,
): Promise<CompteRendu> {
  const { travailId, pieceId } = travail;
  noterLObjet({ piece: pieceId });
  const aFaire = await api.rpc<RelectureAFaire>("capture", "relectureAFaire", [travailId]);
  if (aFaire.pieceId !== pieceId) {
    throw new Error(`relecture : le travail ${travailId} ne vise pas la pièce ${pieceId}`);
  }
  const avant = qualiteDeLecture(aFaire);
  /*
   * Le rattrapage différé, au journal : relu ou non, et pourquoi. Une
   * abstention est une raison nommée (`abstention_<motif>`), jamais un silence.
   */
  const rattrapage = (raison: RaisonDuRattrapage, declenche: boolean) => ({
    declenche,
    raison,
    differe: true,
    qualiteAvant: avant,
  });
  const abstention = (raison: string, detail: Record<string, unknown> = {}): CompteRendu => {
    tracerLeRattrapage(pieceId, "relecture", rattrapage(`abstention_${raison}`, false));
    return { motif: `relecture.abstention.${raison}`, detail };
  };
  if (aFaire.abstention) return abstention(aFaire.abstention, { trace: aFaire.trace });

  if (avant >= QUALITE_PARFAITE) return abstention("deja_parfaite");
  const autre = autreLecteur(aFaire.consigne, lecteurs.secondLecteurDisponible());
  if (!autre) return abstention("sans_autre_lecteur");

  const declenchee = rattrapage(raisonDuRattrapage(aFaire, false, true, false), true);
  const { contexte, parametres, sudoku, lire, decimalesDe } = await preparer(
    api,
    pieceId,
    lecteurs,
  );
  const { lecture: seconde, construite } = await lire({ ...parametres, ...autre }, "relecture");
  await journaliser(api, contexte.piece.tenantId, pieceId, seconde);

  const apres = qualiteDeLecture(construite);
  /*
   * Une relecture demandée pour ses LIGNES (`consigne.lignes`) est retenue, à qualité
   * égale, quand le moteur PROUVE ses lignes : la somme des lignes, taux par taux, ferme
   * sur le total. C'est le calcul qui tranche, jamais le lecteur (l'IA ne rend aucun
   * verdict).
   */
  const lignesProuvees = aFaire.consigne.lignes === true && sudoku.lignes(seconde) === "prouvees";
  const retenue = relectureRetenue(avant, apres, lignesProuvees);
  const detail = { avant, apres, lecteur: seconde.lecteur, lignesProuvees };
  tracerLeRattrapage(pieceId, "relecture", declenchee, {
    qualiteApres: apres,
    retenue,
    lecteur: seconde.lecteur,
  });
  if (!retenue) return { motif: "relecture.ecartee", detail };

  const { lecture } = lectureAPersister(pieceId, contexte.packId, seconde, construite);
  try {
    await tracerLaPersistance(pieceId, "relecture", construite, decimalesDe(construite), () =>
      api.rpc<{ extractionId: string | null }>("capture", "persisterRelecture", [
        { ...lecture, travailId },
      ]),
    );
  } catch (e: unknown) {
    // Une personne a corrigé la pièce PENDANT la relecture : la base refuse,
    // et la relecture s'abstient — la correction humaine l'emporte.
    if (e instanceof Error && e.message.includes("refus.relecture.corrigee")) {
      return abstention("correction_humaine", { ...detail, pendant: true });
    }
    throw e;
  }
  await sudoku.inscrire(seconde);
  await api.rpc<{ verdict: string }>("capture", "analyser", [pieceId]);
  return { motif: "relecture.retenue", detail };
}
