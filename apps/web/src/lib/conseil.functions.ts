/**
 * Le conseil, côté fonctions serveur : la question libre de l'expert au corpus.
 *
 * La clé du modèle ne quitte pas le serveur ; l'appel passe donc ici, sous
 * l'identité portée par le cookie, comme la lecture d'une pièce. Les gestes
 * d'arbitrage, eux, n'appellent aucun modèle et passent par le dépôt.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { repondreAuCabinet } from "@/lib/regalica/ask.server";
import { exigerSession } from "@/lib/session-middleware";

const RepondreInput = z.object({
  tenantId: z.string().uuid(),
  question: z.string().trim().min(3).max(4000),
  locale: z.enum(["fr", "en", "ar"]).default("fr"),
});

export const conseilRepondre = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => RepondreInput.parse(data))
  .handler(({ data, context }) =>
    repondreAuCabinet(context.api, {
      tenantId: data.tenantId,
      question: data.question,
      locale: data.locale,
    }),
  );
