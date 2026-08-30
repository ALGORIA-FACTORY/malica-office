/**
 * Le fil de Regalica. Aucun texte pré-écrit, aucune simulation : chaque réponse
 * vient d'un appel DeepSeek journalisé dans `agents.agent_runs`, avec son coût
 * et sa latence. Le raisonnement est affiché quand le modèle le rend.
 */

import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { regalicaAsk } from "@/lib/regalica.functions";
import { cn } from "@/lib/utils";

interface Turn {
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  meta?: string;
}

export function RegalicaChat({
  tenantId,
  pieceId,
  placeholder,
  className,
}: {
  tenantId: string | null | undefined;
  pieceId?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const ask = useServerFn(regalicaAsk);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: async (question: string) => {
      if (!tenantId) throw new Error(t("regalica.chat.noTenant"));
      return ask({
        data: {
          tenantId,
          pieceId: pieceId ?? null,
          question,
          locale,
          mode: "reasoner" as const,
          history: turns.map((x) => ({ role: x.role, content: x.content })).slice(-8),
        },
      });
    },
    onSuccess: (res) => {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          reasoning: res.reasoning,
          meta: `${res.model} · ${(res.latencyMs / 1000).toFixed(1)} s · ${res.tokensIn ?? 0}/${res.tokensOut ?? 0} jetons`,
        },
      ]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6 }));
    },
  });

  function submit() {
    const q = draft.trim();
    if (!q || mutation.isPending) return;
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setDraft("");
    mutation.mutate(q);
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div ref={listRef} className="max-h-[42vh] min-h-0 space-y-3 overflow-y-auto">
        {turns.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {t("regalica.chat.intro")}
          </p>
        ) : null}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={cn(
              "border border-border px-3 py-2 text-[12.5px] leading-relaxed",
              turn.role === "user" ? "bg-muted/40" : "bg-card",
            )}
          >
            <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {turn.role === "user" ? t("regalica.chat.you") : t("regalica.chat.her")}
            </p>
            <p className="whitespace-pre-wrap">{turn.content}</p>
            {turn.reasoning ? (
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="mt-2 text-[11px] underline decoration-dotted underline-offset-4 text-muted-foreground"
              >
                {open === i ? t("regalica.chat.hideThinking") : t("regalica.chat.showThinking")}
              </button>
            ) : null}
            {open === i && turn.reasoning ? (
              <p className="mt-2 whitespace-pre-wrap border-s-2 border-border ps-3 font-mono text-[11px] text-muted-foreground">
                {turn.reasoning}
              </p>
            ) : null}
            {turn.meta ? (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">{turn.meta}</p>
            ) : null}
          </div>
        ))}
        {mutation.isPending ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            {t("regalica.chat.thinking")}
          </p>
        ) : null}
        {mutation.isError ? (
          <p className="border border-border px-3 py-2 text-[12px]">
            {mutation.error instanceof Error ? mutation.error.message : t("regalica.chat.error")}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border border-border px-2 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder ?? t("regalica.chat.placeholder")}
          aria-label={t("regalica.chat.placeholder")}
          className="min-h-[36px] w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={submit}
          disabled={mutation.isPending || !draft.trim()}
          className="min-h-[32px] border border-border px-2 text-[12px] disabled:opacity-40"
        >
          {t("regalica.chat.send")}
        </button>
      </div>
    </div>
  );
}
