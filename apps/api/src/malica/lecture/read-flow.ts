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

import type { AppelApi } from "../appel-local.ts";

import { confianceParChamp } from "../../scan/confiance.ts";

import { buildExtractFromTokenPlan } from "./read-piece.ts";
import { secondLecteurDisponible } from "./paddle.ts";
import { runVisionRead } from "./vision.ts";
import type { LectureDePiece } from "@malica/socle/ports/malica";

interface ContexteLecture {
  piece: { id: string; tenantId: string; source: string; contentType: string | null };
  packId: string;
  /** La devise du dossier et son échelle, toutes deux issues du pack. */
  currency: string;
  moneyDecimals: number;
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
  const verdict = await api.rpc<{ autorisee: boolean; motif: string }>(
    "capture",
    "lectureAutorisee",
    [pieceId],
  );
  if (!verdict.autorisee) throw new LectureRefusee(verdict.motif);

  // La pièce, son organisation, le pack en vigueur, les taux et les charges :
  // un appel là où il en fallait cinq, mêmes requêtes côté base.
  const contexte = await api.rpc<ContexteLecture>("capture", "contexteLecture", [pieceId]);

  const fichier = await api.contenu(pieceId);
  const bytes = fichier.octets;
  // Le type vient de la base. L'ancien flux le tenait du Blob rendu par le
  // stockage, avec le même repli lorsqu'il était vide.
  const mime = contexte.piece.contentType || fichier.type || "image/jpeg";
  const dataUrl = `data:${mime};base64,${toBase64(bytes)}`;

  const chargeCodes = Array.from(
    new Map(contexte.chargeCodes.map((c) => [c.code, { code: c.code, label: c.label }])).values(),
  );

  const premiereLecture = await lecteurs.lire({
    dataUrl,
    mime,
    // Les octets bruts servent au PDF : sa couche de texte se lit sans modèle.
    bytes,
    chargeCodes,
    // Les tiers du dossier : l'œil doit reconnaître un fournisseur déjà
    // enregistré au lieu de le relire comme un inconnu à chaque facture.
    tiers: contexte.tiers,
    dossier: contexte.dossier,
    // La devise du dossier : elle sert quand la pièce n'en imprime aucune.
    // Sans elle, une facture muette devenait tunisienne par défaut.
    devise: contexte.currency,
    taxCodes: contexte.taxCodes.map((r) => ({
      code: r.code,
      label: r.label,
      // `String(nombre)` : exactement ce que faisait `String(r.rate)` sur la
      // valeur JSON rendue par PostgREST.
      rate: String(r.rate),
    })),
  });

  let read = premiereLecture;
  let built = buildExtractFromTokenPlan({
    tokens: read.tokens,
    selection: read.selection,
    // Trois décimales pour le dinar — mais dites par le pack, jamais écrites
    // ici : le solveur des montants s'en sert pour décider de l'ambiguïté.
    decimals: contexte.moneyDecimals,
    // Le matricule de la fiche : c'est lui qui DÉDUIT le sens de la pièce, au
    // lieu de croire ce que le modèle en dit.
    matriculeDossier: contexte.dossier.identifiantFiscal,
  });

  /*
   * ================================= DEUX LECTEURS, ET LE SECOND RATTRAPE LE PREMIER
   *
   * 14 octobre 2026, a la demande du dirigeant : « garder les deux, Paddle en
   * premiere couche et l'OCR en seconde ».
   *
   * L'ordre est desormais : la couche de texte d'un PDF (exacte, gratuite,
   * instantanee), puis PaddleOCR, puis le modele de vision. Et ce bloc-ci est
   * le rattrapage : quand la lecture sort INCOMPLETE, on relit la piece avec
   * l'AUTRE lecteur, et on garde celle qui remplit le contrat.
   *
   * LE DECLENCHEUR N'EST PAS UN SEUIL, C'EST UNE PREUVE. Le contrat sort
   * `extract.v1.partiel` : le schema n'est pas rempli, et ce n'est pas une
   * impression.
   *
   * ON NE GARDE LA SECONDE QUE SI ELLE FAIT MIEUX — un contrat complet la ou
   * la premiere etait partielle. A egalite, la premiere gagne : on ne remplace
   * pas un defaut connu par un defaut inconnu.
   *
   * ET ON NE RELIT PAS DEUX FOIS AVEC LE MEME. Si PaddleOCR n'est pas deploye,
   * la premiere lecture vient deja du modele de vision, et le rattrapage
   * n'aurait rien d'autre a proposer qu'un second appel payant a l'identique.
   */
  const premierEtaitPaddle = premiereLecture.readModel.includes("PP-OCR");
  const unAutreLecteurExiste = premierEtaitPaddle || lecteurs.secondLecteurDisponible();

  if (built.contract !== "extract.v1" && unAutreLecteurExiste) {
    const secondeLecture = await lecteurs.lire({
      dataUrl,
      mime,
      bytes,
      chargeCodes,
      tiers: contexte.tiers,
      dossier: contexte.dossier,
      devise: contexte.currency,
      taxCodes: contexte.taxCodes.map((r) => ({
        code: r.code,
        label: r.label,
        rate: String(r.rate),
      })),
      // L'autre lecteur, exactement : Paddle a lu, donc le modele de vision
      // relit ; le modele a lu, donc Paddle relit.
      sansPaddle: premierEtaitPaddle,
    });
    const secondBuilt = buildExtractFromTokenPlan({
      tokens: secondeLecture.tokens,
      selection: secondeLecture.selection,
      decimals: contexte.moneyDecimals,
      matriculeDossier: contexte.dossier.identifiantFiscal,
    });
    if (secondBuilt.contract === "extract.v1") {
      read = secondeLecture;
      built = secondBuilt;
    }
  }

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

  await api.rpc<void>("capture", "persisterLecture", [
    {
      pieceId,
      packId: contexte.packId,
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
  ]);

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
  const journal = await Promise.all(
    (
      [
        ["malica.lecture.releve", read.readModel, "vision", read.releve],
        // Le role vient de la MEME source que le modele : voir `selectRole`.
        ["malica.lecture.designation", read.selectModel, read.selectRole, read.designation],
      ] as const
    ).map(([agent, model, role, passe]) =>
      api
        .rpc<string | null>("capture", "journaliserAgent", [
          {
            tenantId: contexte.piece.tenantId,
            agent,
            model,
            role,
            status: "ok",
            latencyMs: passe.latencyMs,
            tokensIn: passe.tokensIn,
            tokensOut: passe.tokensOut,
            pieceId,
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

  // La pièce se juge sur ce que la base porte désormais.
  const analyse = await api.rpc<{ verdict: string }>("capture", "analyser", [pieceId]);

  /*
   * Le deuxième temps du compteur, et le dernier geste avant de rendre : la
   * base porte le résultat, l'analyse a abouti, rien ne peut plus lever que
   * le comptage lui-même. Ni plus tôt (une lecture qui échoue ne se facture
   * pas), ni plus d'une fois (la base ne compte jamais deux fois une pièce).
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
