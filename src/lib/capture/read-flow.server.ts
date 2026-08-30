/**
 * Orchestration de la lecture citée d'une pièce.
 * Le cerveau : télécharge la pièce, appelle l'œil (deux passes), passe la
 * sortie au filtre du plan de tokens, persiste par RPC gouvernée.
 * Aucun montant ne sort d'ici sans son token d'origine.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { buildExtractFromTokenPlan } from "./read-piece.server";
import { runVisionRead } from "./vision.server";

type Client = SupabaseClient<Database>;

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

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

export async function readPieceFlow(supabase: Client, pieceId: string): Promise<ReadPieceResult> {
  const { data: piece, error: pieceErr } = await supabase
    .from("pieces_v")
    .select("id, tenant_id, storage_path, source")
    .eq("id", pieceId)
    .maybeSingle();
  if (pieceErr) throw new Error(pieceErr.message);
  if (!piece) throw new Error("pièce introuvable ou non autorisée");

  const { data: org, error: orgErr } = await supabase
    .from("organizations_v")
    .select("jurisdiction, currency")
    .eq("id", piece.tenant_id as string)
    .maybeSingle();
  if (orgErr) throw new Error(orgErr.message);

  // Les codes de taux viennent du pack en base — aucune constante fiscale ici.
  const today = new Date().toISOString().slice(0, 10);
  const { data: packs, error: packErr } = await supabase
    .from("ref_packs_v")
    .select("id, effective_from")
    .eq("jurisdiction", (org?.jurisdiction as string) ?? "TN")
    .lte("effective_from", today)
    .order("effective_from", { ascending: false })
    .limit(1);
  if (packErr) throw new Error(packErr.message);
  const packId = packs?.[0]?.id as string | undefined;
  if (!packId) throw new Error("aucun référentiel en vigueur pour cette juridiction");

  const { data: rates, error: ratesErr } = await supabase
    .from("ref_tva_rates_v")
    .select("code, label, rate")
    .eq("pack_version_id", packId);
  if (ratesErr) throw new Error(ratesErr.message);

  const { data: file, error: dlErr } = await supabase.storage
    .from("pieces")
    .download(piece.storage_path as string);
  if (dlErr || !file)
    throw new Error(`téléchargement de la pièce impossible : ${dlErr?.message ?? "inconnu"}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const dataUrl = `data:${mime};base64,${toBase64(bytes)}`;

  const { data: charges, error: chargesErr } = await supabase
    .from("ref_fiscal_charges_v")
    .select("code, label")
    .eq("pack_version_id", packId);
  if (chargesErr) throw new Error(chargesErr.message);
  const chargeCodes = Array.from(
    new Map(
      (charges ?? []).map((c) => [
        c.code as string,
        { code: c.code as string, label: (c.label as string) ?? (c.code as string) },
      ]),
    ).values(),
  );

  const read = await runVisionRead({
    dataUrl,
    mime,
    // Les octets bruts servent au PDF : sa couche de texte se lit sans modèle.
    bytes,
    chargeCodes,
    taxCodes: (rates ?? []).map((r) => ({
      code: r.code as string,
      label: (r.label as string) ?? (r.code as string),
      rate: String(r.rate),
    })),
  });

  const built = buildExtractFromTokenPlan({
    tokens: read.tokens,
    selection: read.selection,
    decimals: 3,
  });

  const { error: persistErr } = await supabase.rpc("capture_read_persist", {
    p_piece: pieceId,
    p_tokens: read.tokens as unknown as never,
    p_contract: built.contract,
    p_extract: built.extract as unknown as never,
    p_citations: built.citations as unknown as never,
    p_flags: built.flags as unknown as never,
  });
  if (persistErr) throw new Error(persistErr.message);

  // Projection des articles cités pour l'analyse par famille (PME).
  // La famille est résolue par le pack (compte, puis motif de désignation) —
  // aucune famille en dur ici, et aucun article sans citation persistée.
  const extract = built.extract as {
    document_kind?: string | null;
    document_date?: string | null;
    articles?: Array<Record<string, string | null>>;
  };
  const articles = extract.articles ?? [];
  if (articles.length > 0) {
    const { data: mappings, error: mapErr } = await supabase
      .from("ref_account_mappings_v")
      .select("document_kind, main_account")
      .eq("pack_version_id", packId)
      .eq("document_kind", extract.document_kind ?? "facture_achat");
    if (mapErr) throw new Error(mapErr.message);
    const mainAccount = mappings?.[0]?.main_account as string | undefined;
    const { error: artErr } = await supabase.rpc("capture_articles_persist", {
      p_piece: pieceId,
      p_pack: packId,
      p_document_date: (extract.document_date ?? null) as unknown as string,
      p_account: (mainAccount ?? null) as unknown as string,
      p_articles: articles as unknown as never,
    });
    if (artErr) throw new Error(artErr.message);
  }

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
