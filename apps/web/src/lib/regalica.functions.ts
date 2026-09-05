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
  /**
   * Le fil où ranger l'échange. Absent : Regalica en ouvre un neuf et rend
   * son identifiant.
   *
   * L'historique ne voyage plus dans ce sens. Il se relit en base à partir de
   * cet identifiant, et la RLS décide de ce que la personne a le droit d'y
   * relire — ce qu'un tableau de messages envoyé par le navigateur ne pouvait
   * pas garantir.
   */
  conversationId: z.string().uuid().nullish(),
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
      conversationId: data.conversationId ?? null,
    }),
  );

/* ------------------------------------------------------------------ les fils
 *
 * Aucune de ces fonctions ne dit à qui appartient un fil : la base le sait, et
 * elle seule décide. R6 — un filtre applicatif oublié ouvre l'accès, une
 * politique oubliée le refuse.
 */

const TenantInput = z.object({ tenantId: z.string().uuid() });
const FilInput = z.object({ conversationId: z.string().uuid() });
const RenommerInput = z.object({
  conversationId: z.string().uuid(),
  titre: z.string().trim().min(1).max(120),
});

export interface ConversationResume {
  id: string;
  titre: string;
  createdAt: string;
  updatedAt: string;
  messages: number;
}

export interface MessageDuFil {
  id: string;
  role: "user" | "assistant";
  contenu: string;
  raisonnement: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export const regalicaConversations = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => TenantInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<ConversationResume[]>("conversations", "lister", [data.tenantId]),
  );

export const regalicaOuvrirFil = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => FilInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<MessageDuFil[]>("conversations", "ouvrir", [data.conversationId]),
  );

export const regalicaRenommerFil = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => RenommerInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<void>("conversations", "renommer", [
      { conversationId: data.conversationId, titre: data.titre },
    ]),
  );

/**
 * Le geste du comptable : juste, ou faux.
 *
 * C'est ce qui construit la banque de cas sans que personne n'écrive une
 * question à froid. Et la ligne qui vaut le plus est celle où les contrôles
 * n'ont rien trouvé et où l'humain dit faux : elle désigne l'angle mort.
 */
const JugerInput = z.object({
  tenantId: z.string().uuid(),
  messageId: z.string().uuid(),
  verdict: z.enum(["juste", "faux"]),
  attendu: z.string().trim().max(2000).nullish(),
});

export const regalicaJuger = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => JugerInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<void>("conversations", "juger", [
      {
        tenantId: data.tenantId,
        messageId: data.messageId,
        verdict: data.verdict,
        attendu: data.attendu ?? null,
      },
    ]),
  );

export const regalicaSupprimerFil = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => FilInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<void>("conversations", "supprimer", [data.conversationId]),
  );
