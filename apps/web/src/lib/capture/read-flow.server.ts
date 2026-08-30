/**
 * Orchestration de la lecture citée d'une pièce.
 * Le cerveau : télécharge la pièce, appelle l'œil (deux passes), passe la
 * sortie au filtre du plan de tokens, persiste par RPC gouvernée.
 * Aucun montant ne sort d'ici sans son token d'origine.
 *
 * Le transport a changé — l'API au lieu de PostgREST, la route de contenu au
 * lieu du stockage Supabase — et rien d'autre. Les deux passes, le plan de
 * tokens et la désignation sont exactement ceux d'avant.
 *
 * Un détail qui n'en est pas un : les taux et les charges arrivent de l'API
 * avec le même type qu'ils avaient de PostgREST — des nombres — et sont remis
 * en chaîne ici de la même façon. « 19 » et « 19.0000 » ne sont pas la même
 * invite, et ce fichier compose une invite.
 */

import type { AppelApi } from "@/lib/api.server";

import { buildExtractFromTokenPlan } from "./read-piece.server";
import { runVisionRead } from "./vision.server";

export interface ReadPieceResult {
  pieceId: string;
  contract: string;
  citations: number;
  flags: Array<{ field: string; code: string; detail?: string }>;
  valid: boolean;
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

interface ContexteLecture {
  piece: { id: string; tenantId: string; source: string; contentType: string | null };
  packId: string;
  taxCodes: Array<{ code: string; label: string; rate: number }>;
  chargeCodes: Array<{ code: string; label: string }>;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

export async function readPieceFlow(api: AppelApi, pieceId: string): Promise<ReadPieceResult> {
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
    decimals: 3,
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
  await api.rpc<void>("capture", "persisterLecture", [
    {
      pieceId,
      packId: contexte.packId,
      tokens: read.tokens,
      contract: built.contract,
      extract: built.extract,
      citations: built.citations,
      flags: built.flags,
      articles: extract.articles ?? [],
      documentKind: extract.document_kind ?? null,
      documentDate: extract.document_date ?? null,
    },
  ]);

  return {
    pieceId,
    contract: built.contract,
    citations: built.citations.length,
    flags: built.flags,
    valid: built.valid,
    model: read.model,
    latencyMs: read.latencyMs,
    tokensIn: read.tokensIn,
    tokensOut: read.tokensOut,
  };
}
