/**
 * Le procès-verbal rédigé par Regalica — la fonction serveur.
 *
 * Elle tourne ici parce que la clé du modèle ne doit jamais atteindre le
 * navigateur, et parce que les moteurs du Socle se nourrissent de plusieurs
 * lectures qu'il vaut mieux enchaîner près de l'API. Elle parle à l'API sous
 * l'identité de l'appelant : la RLS décide de ce qu'elle peut lire.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { redigerLePv } from "@/lib/pv/rediger.server";
import { exigerSession } from "@/lib/session-middleware";

const RedigerInput = z.object({
  pvId: z.string().uuid(),
  locale: z.enum(["fr", "en", "ar"]).default("fr"),
});

export const pvRediger = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => RedigerInput.parse(data))
  .handler(({ data, context }) =>
    redigerLePv(context.api, { pvId: data.pvId, locale: data.locale }),
  );
