import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readPieceFlow } from "@/lib/capture/read-flow.server";

export const readPiece = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ pieceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => readPieceFlow(context.supabase, data.pieceId));
