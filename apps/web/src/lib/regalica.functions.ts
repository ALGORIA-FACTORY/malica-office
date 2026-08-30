import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { askRegalica } from "@/lib/regalica/ask.server";
import { exigerSession } from "@/lib/session-middleware";

const AskInput = z.object({
  tenantId: z.string().uuid(),
  pieceId: z.string().uuid().nullish(),
  question: z.string().trim().min(2).max(4000),
  locale: z.enum(["fr", "en", "ar"]).default("fr"),
  mode: z.enum(["reasoner", "chat"]).default("reasoner"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .max(16)
    .default([]),
});

export const regalicaAsk = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => AskInput.parse(data))
  .handler(async ({ data, context }) =>
    askRegalica(context.api, {
      tenantId: data.tenantId,
      pieceId: data.pieceId ?? null,
      question: data.question,
      locale: data.locale,
      mode: data.mode,
      history: data.history,
    }),
  );
