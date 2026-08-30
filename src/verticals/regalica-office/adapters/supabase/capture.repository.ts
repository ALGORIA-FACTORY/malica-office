import { supabase } from "@/integrations/supabase/client";
import { readPiece } from "@/lib/office-capture.functions";

import type {
  CaptureRepository,
  Citation,
  Extraction,
  NewPiece,
  Piece,
  PieceDossier,
  PieceStatus,
  Token,
} from "../../ports/repositories";

function toPiece(row: Record<string, unknown>): Piece {
  return {
    id: row["id"] as string,
    tenantId: row["tenant_id"] as string,
    entityId: (row["entity_id"] as string | null) ?? null,
    status: row["status"] as PieceStatus,
    source: row["source"] as "photo" | "pdf",
    vis: row["vis"] as "personnel" | "partage",
    storagePath: row["storage_path"] as string,
    createdAt: row["created_at"] as string,
  };
}

export function createSupabaseCaptureRepository(): CaptureRepository {
  return {
    async register(input: NewPiece): Promise<string> {
      const ext = input.fileName.split(".").pop()?.toLowerCase() || (input.source === "pdf" ? "pdf" : "jpg");
      const objectName = `${input.tenantId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("pieces")
        .upload(objectName, input.file, {
          upsert: false,
          ...(input.file.type ? { contentType: input.file.type } : {}),
        });
      if (upErr) throw upErr;

      const { data, error } = await supabase.rpc("capture_piece_register", {
        p_tenant: input.tenantId,
        p_source: input.source,
        p_storage_path: objectName,
        p_idempotency_key: input.idempotencyKey,
        ...(input.entityId ? { p_entity: input.entityId } : {}),
        p_vis: input.vis,
      });
      if (error) throw error;
      return data as unknown as string;
    },

    async list(tenantId: string): Promise<Piece[]> {
      const { data, error } = await supabase
        .from("pieces_v")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((r) => toPiece(r as Record<string, unknown>));
    },

    async dossier(pieceId: string): Promise<PieceDossier> {
      const { data: pieceRow, error: pErr } = await supabase
        .from("pieces_v")
        .select("*")
        .eq("id", pieceId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!pieceRow) throw new Error("piece.not_found");
      const piece = toPiece(pieceRow as Record<string, unknown>);

      const [{ data: exRows, error: exErr }, { data: citRows, error: cErr }, { data: tokRows, error: tErr }, signed] =
        await Promise.all([
          supabase
            .from("extractions_v")
            .select("id, contract, payload, flags, created_at")
            .eq("piece_id", pieceId)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase.from("citations_v").select("field, page, bbox, zone").eq("piece_id", pieceId),
          supabase
            .from("token_plan_v")
            .select("page, ordinal, text, x0, y0, x1, y1")
            .eq("piece_id", pieceId)
            .order("ordinal", { ascending: true }),
          supabase.storage.from("pieces").createSignedUrl(piece.storagePath, 600),
        ]);
      if (exErr) throw exErr;
      if (cErr) throw cErr;
      if (tErr) throw tErr;

      const exRow = exRows?.[0];
      const extraction: Extraction | null = exRow
        ? {
            id: exRow.id as string,
            contract: exRow.contract as string,
            payload: exRow.payload,
            flags: (exRow.flags as Extraction["flags"]) ?? [],
            createdAt: exRow.created_at as string,
          }
        : null;

      const citations: Citation[] = (citRows ?? []).map((c) => ({
        field: c.field as string,
        page: Number(c.page),
        bbox: (c.bbox as Citation["bbox"]) ?? { x0: 0, y0: 0, x1: 0, y1: 0 },
        zone: (c.zone as string | null) ?? null,
      }));

      const tokens: Token[] = (tokRows ?? []).map((t) => ({
        page: Number(t.page),
        ordinal: Number(t.ordinal),
        text: t.text as string,
        x0: Number(t.x0),
        y0: Number(t.y0),
        x1: Number(t.x1),
        y1: Number(t.y1),
      }));

      return {
        piece,
        fileUrl: signed.data?.signedUrl ?? null,
        extraction,
        citations,
        tokens,
      };
    },

    async read(pieceId: string) {
      const res = await readPiece({ data: { pieceId } });
      return { contract: res.contract, citations: res.citations, valid: res.valid };
    },
  };
}
