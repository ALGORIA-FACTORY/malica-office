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

export async function readPieceFlow(api: AppelApi, pieceId: string): Promise<LectureDePiece> {
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

  const read = await runVisionRead({
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

  const built = buildExtractFromTokenPlan({
    tokens: read.tokens,
    selection: read.selection,
    // Trois décimales pour le dinar — mais dites par le pack, jamais écrites
    // ici : le solveur des montants s'en sert pour décider de l'ambiguïté.
    decimals: contexte.moneyDecimals,
  });

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

  // Le journal des exécutions : une ligne par organe, chacune à son tarif.
  // Un organe sans tarif en vigueur (Qwen-VL-OCR, dont le prix n'a pas été
  // relevé) ne se journalise pas : agents_run_log refuse d'écrire un coût sans
  // origine. On le DIT dans la réponse, au lieu de l'avaler.
  const journal = await Promise.all(
    (
      [
        ["malica.lecture.releve", read.readModel, "vision", read.releve],
        ["malica.lecture.designation", read.selectModel, "reasoner", read.designation],
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
          (e: unknown) => ({
            agent,
            model,
            journalise: false as const,
            raison: e instanceof Error ? e.message.slice(0, 200) : String(e),
          }),
        ),
    ),
  );

  // La pièce se juge sur ce que la base porte désormais.
  const analyse = await api.rpc<{ verdict: string }>("capture", "analyser", [pieceId]);

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
