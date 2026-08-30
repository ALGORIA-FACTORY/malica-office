import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { readPieceFlow } from "@/lib/capture/read-flow.server";
import { exigerSession } from "@/lib/session-middleware";

export const readPiece = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => z.object({ pieceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => readPieceFlow(context.api, data.pieceId));
