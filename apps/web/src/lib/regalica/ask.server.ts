/**
 * Le geste de Regalica : lire le dossier, répondre, se faire journaliser.
 * Aucun chiffre n'est inventé : la consigne système l'interdit et le dossier
 * transmis ne contient que des valeurs déjà produites par le Socle.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import {
  callDeepSeek,
  DeepSeekError,
  type DeepSeekMessage,
  type DeepSeekRole,
} from "./deepseek.server";
import { loadRegalicaContext } from "./context.server";

type Client = SupabaseClient<Database>;

const LANGUES: Record<string, string> = {
  fr: "français",
  en: "English",
  ar: "العربية",
};

function systemPrompt(locale: string): string {
  const langue = LANGUES[locale] ?? LANGUES["fr"];
  return [
    "Tu es Regalica, l'assistante comptable de Regalica Office (Système Comptable Tunisien).",
    `Tu réponds exclusivement en ${langue}.`,
    "",
    "Doctrine, non négociable :",
    "1. Tu ne calcules jamais. Tout montant, taux, verdict ou écriture vient du Socle déterministe et t'est fourni dans le DOSSIER. Tu ne fais aucune addition, aucune conversion, aucun arrondi.",
    "2. Si un chiffre n'est pas dans le DOSSIER, tu dis qu'il n'est pas disponible et tu nommes le geste qui le produirait. Tu n'estimes jamais.",
    "3. Tu cites toujours l'origine : identifiant d'écriture, statut de pièce, champ cité, échéance. Un montant sans origine ne se dit pas.",
    "4. Tu ne requalifies pas un montant et tu ne décides pas seule d'une conformité. Un retour au client se fait avec un motif pris dans la liste MOTIFS, jamais un motif inventé.",
    "5. Tu ne cites aucun taux de TVA, numéro de compte ou seuil qui ne figure pas dans le DOSSIER : le référentiel est versionné en base.",
    "",
    "Style : sobre, dense, orienté action. Trois phrases quand trois suffisent. Pas d'emoji, pas de flatterie.",
  ].join("\n");
}

export interface AskRegalicaResult {
  answer: string;
  reasoning: string | null;
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  runId: string | null;
}

export async function askRegalica(
  supabase: Client,
  input: {
    tenantId: string;
    pieceId?: string | null;
    question: string;
    locale: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    /** Le raisonneur pour l'analyse, la conversation pour le fil rapide. */
    mode?: DeepSeekRole;
  },
): Promise<AskRegalicaResult> {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY absente : Regalica ne peut pas répondre");

  const dossier = await loadRegalicaContext(supabase, input.tenantId, input.pieceId ?? null);
  const role: DeepSeekRole = input.mode ?? "reasoner";

  const messages: DeepSeekMessage[] = [
    { role: "system", content: systemPrompt(input.locale) },
    {
      role: "system",
      content: `DOSSIER (seule source de vérité chiffrée) :\n${JSON.stringify(dossier)}`,
    },
    ...(input.history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.question },
  ];

  let result: Awaited<ReturnType<typeof callDeepSeek>> | null = null;
  let failure: DeepSeekError | Error | null = null;
  try {
    result = await callDeepSeek({ apiKey, role, messages });
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
  }

  const { data: runId } = await supabase.rpc("agents_run_log", {
    p_tenant: input.tenantId,
    p_agent: "regalica.conseil",
    p_model: result?.model ?? (role === "reasoner" ? "deepseek-reasoner" : "deepseek-chat"),
    p_role: role,
    p_status: result ? "ok" : "error",
    p_latency_ms: result?.latencyMs ?? 0,
    ...(result?.tokensIn != null ? { p_tokens_in: result.tokensIn } : {}),
    ...(result?.tokensOut != null ? { p_tokens_out: result.tokensOut } : {}),
    ...(input.pieceId ? { p_piece: input.pieceId } : {}),
    ...(failure ? { p_error: failure.message.slice(0, 500) } : {}),
  });

  if (!result) throw failure ?? new Error("Regalica indisponible");

  return {
    answer: result.answer,
    reasoning: result.reasoning,
    model: result.model,
    latencyMs: result.latencyMs,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    runId: (runId as string | null) ?? null,
  };
}
