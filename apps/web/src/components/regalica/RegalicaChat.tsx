/**
 * Le fil de Regalica. Aucun texte pré-écrit, aucune simulation : chaque réponse
 * vient d'un appel DeepSeek journalisé dans `agents.agent_runs`, avec son coût
 * et sa latence. Le raisonnement est affiché quand le modèle le rend.
 *
 * ============================================================ LES FILS GARDÉS
 *
 * Une conversation survit au rechargement : elle vit en base, elle porte un
 * titre que Regalica propose au premier échange, et elle n'appartient qu'à la
 * personne qui l'a écrite — c'est la RLS qui le tient, pas cet écran.
 *
 * L'historique ne remonte plus d'ici vers le serveur. On envoie l'identifiant
 * du fil ; le serveur relit ce que la base l'autorise à relire. Un fil composé
 * par le navigateur serait un fil qu'on peut forger.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";

interface Turn {
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  meta?: string;
  /** Ce que le cabinet juge. Absent sur les tours repris d'un fil ancien. */
  messageId?: string | null;
  /** Ce que les contrôles ont laissé passer, et ce qu'ils ont signalé. */
  signale?: string[];
}

export function RegalicaChat({
  tenantId,
  pieceId,
  placeholder,
  className,
  technique = false,
}: {
  tenantId: string | null | undefined;
  pieceId?: string | null;
  placeholder?: string;
  className?: string;
  /**
   * Le nom du modèle, sa latence, ses jetons, et son raisonnement déplié.
   *
   * Ce sont des instruments, pas une réponse. Un expert-comptable peut vouloir
   * savoir ce qu'a coûté une question et sur quoi elle a raisonné ; un
   * dirigeant de PME n'a rien à faire de « deepseek-reasoner · 8609 jetons »,
   * et le lui montrer transforme une conseillère en tableau de bord.
   *
   * Fermé par défaut : la surface qui en a besoin le demande.
   */
  technique?: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [filId, setFilId] = useState<string | null>(null);
  const [vue, setVue] = useState<"fil" | "liste">("fil");
  // Deux gestes pour effacer : le premier demande, le second exécute. Un fil
  // supprimé ne se retrouve pas, et un seul tap n'est pas une décision.
  const [aEffacer, setAEffacer] = useState<string | null>(null);
  const [enRenommage, setEnRenommage] = useState<string | null>(null);
  const [nouveauTitre, setNouveauTitre] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  // Un verdict par message et par personne : on juge, on ne vote pas.
  const [juges, setJuges] = useState<Record<string, "juste" | "faux">>({});

  const fils = useQuery({
    queryKey: ["regalica-fils", tenantId],
    queryFn: () => office().conversations.lister(tenantId!),
    enabled: !!tenantId,
  });

  const titreCourant = fils.data?.find((f) => f.id === filId)?.titre ?? "";

  const mutation = useMutation({
    mutationFn: async (question: string) => {
      if (!tenantId) throw new Error(t("regalica.chat.noTenant"));
      return office().regalica.demander({
        tenantId,
        pieceId: pieceId ?? null,
        question,
        locale,
        mode: "reasoner",
        conversationId: filId,
      });
    },
    onSuccess: (res) => {
      setFilId(res.conversationId);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          reasoning: res.reasoning,
          meta: `${res.model} · ${(res.latencyMs / 1000).toFixed(1)} s · ${res.tokensIn ?? 0}/${res.tokensOut ?? 0} jetons`,
          messageId: res.messageId,
          // Seuls les « signaler » remontent : ils portent sur NOTRE corpus,
          // pas sur la réponse. Le client n'a rien à en faire ; le cabinet, si.
          signale: res.controles.filter((c) => c.suite === "signaler").map((c) => c.detail),
        },
      ]);
      void qc.invalidateQueries({ queryKey: ["regalica-fils", tenantId] });
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6 }));
    },
  });

  const reprise = useMutation({
    mutationFn: (id: string) => office().conversations.ouvrir(id),
    onSuccess: (messages, id) => {
      setFilId(id);
      setTurns(
        messages.map((m) => {
          // `meta` reste ABSENT quand le message n'en porte pas : le poser à
          // `undefined` n'est pas la même chose, et le typage strict le refuse.
          const tour: Turn = { role: m.role, content: m.contenu, reasoning: m.raisonnement };
          if (m.model && m.latencyMs !== null) {
            tour.meta = `${m.model} · ${(m.latencyMs / 1000).toFixed(1)} s · ${m.tokensIn ?? 0}/${m.tokensOut ?? 0} jetons`;
          }
          return tour;
        }),
      );
      setVue("fil");
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6 }));
    },
  });

  const renommage = useMutation({
    mutationFn: (v: { conversationId: string; titre: string }) =>
      office().conversations.renommer(v),
    onSuccess: () => {
      setEnRenommage(null);
      void qc.invalidateQueries({ queryKey: ["regalica-fils", tenantId] });
    },
  });

  const effacement = useMutation({
    mutationFn: (id: string) => office().conversations.supprimer(id),
    onSuccess: (_r, id) => {
      setAEffacer(null);
      if (id === filId) {
        setFilId(null);
        setTurns([]);
      }
      void qc.invalidateQueries({ queryKey: ["regalica-fils", tenantId] });
    },
  });

  // Changer de dossier change de fils : garder l'ancien à l'écran montrerait
  // les questions d'une société pendant qu'on en regarde une autre.
  useEffect(() => {
    setFilId(null);
    setTurns([]);
    setVue("fil");
  }, [tenantId]);

  function marquer(messageId: string, verdict: "juste" | "faux") {
    if (!tenantId) return;
    setJuges((p) => ({ ...p, [messageId]: verdict }));
    void office().conversations.juger({ tenantId, messageId, verdict, attendu: null });
  }

  function submit() {
    const q = draft.trim();
    if (!q || mutation.isPending) return;
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setDraft("");
    mutation.mutate(q);
  }

  function nouveauFil() {
    setFilId(null);
    setTurns([]);
    setOpen(null);
    setVue("fil");
  }

  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(new Date(iso));

  /* ------------------------------------------------------------- la liste */
  if (vue === "liste") {
    return (
      <div className={cn("flex min-h-0 flex-col gap-3", className)}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("regalica.fils.titre")}
          </p>
          <button
            type="button"
            onClick={() => setVue("fil")}
            className="border border-border px-2 py-1 text-[11px] hover:bg-accent"
          >
            {t("regalica.fils.retour")}
          </button>
        </div>

        <div className="max-h-[42vh] min-h-0 space-y-2 overflow-y-auto">
          {fils.isPending ? (
            <p className="text-[12px] text-muted-foreground">{t("common.loading")}</p>
          ) : (fils.data ?? []).length === 0 ? (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {t("regalica.fils.vide")}
            </p>
          ) : (
            (fils.data ?? []).map((f) => (
              <div key={f.id} className="border border-border px-3 py-2">
                {enRenommage === f.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={nouveauTitre}
                      onChange={(e) => setNouveauTitre(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && nouveauTitre.trim()) {
                          renommage.mutate({ conversationId: f.id, titre: nouveauTitre.trim() });
                        }
                        if (e.key === "Escape") setEnRenommage(null);
                      }}
                      aria-label={t("regalica.fils.renommer")}
                      autoFocus
                      className="min-h-[30px] w-full border-b border-border bg-transparent text-[12.5px] outline-none"
                    />
                    <button
                      type="button"
                      disabled={!nouveauTitre.trim() || renommage.isPending}
                      onClick={() =>
                        renommage.mutate({ conversationId: f.id, titre: nouveauTitre.trim() })
                      }
                      className="flex-none border border-border px-2 py-1 text-[11px] disabled:opacity-40"
                    >
                      {t("regalica.fils.valider")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => reprise.mutate(f.id)}
                    className="block w-full text-start"
                  >
                    <span className="block text-[13px] font-medium">
                      {f.titre || t("regalica.fils.sansTitre")}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {dateCourte(f.updatedAt)} ·{" "}
                      {t("regalica.fils.messages", { count: f.messages })}
                    </span>
                  </button>
                )}

                {aEffacer === f.id ? (
                  <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                    <p className="min-w-0 flex-1 text-[11.5px] leading-snug">
                      {t("regalica.fils.confirmer")}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAEffacer(null)}
                      className="flex-none border border-border px-2 py-1 text-[11px]"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={effacement.isPending}
                      onClick={() => effacement.mutate(f.id)}
                      className="flex-none border border-signal-stop px-2 py-1 text-[11px] text-signal-stop disabled:opacity-40"
                    >
                      {t("regalica.fils.supprimer")}
                    </button>
                  </div>
                ) : enRenommage === f.id ? null : (
                  <div className="mt-2 flex gap-3 border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEnRenommage(f.id);
                        setNouveauTitre(f.titre);
                      }}
                      className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-4"
                    >
                      {t("regalica.fils.renommer")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAEffacer(f.id)}
                      className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-4"
                    >
                      {t("regalica.fils.supprimer")}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={nouveauFil}
          className="min-h-[36px] border border-foreground bg-foreground text-[12px] font-medium text-background"
        >
          {t("regalica.fils.nouveau")}
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- le fil */
  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {titreCourant || t("regalica.fils.enCours")}
        </p>
        <span className="flex flex-none gap-1.5">
          {turns.length > 0 ? (
            <button
              type="button"
              onClick={nouveauFil}
              className="border border-border px-2 py-1 text-[11px] hover:bg-accent"
            >
              {t("regalica.fils.nouveau")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setVue("liste")}
            className="border border-border px-2 py-1 text-[11px] hover:bg-accent"
          >
            {t("regalica.fils.voir")}
          </button>
        </span>
      </div>

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
            {technique && turn.reasoning ? (
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="mt-2 text-[11px] underline decoration-dotted underline-offset-4 text-muted-foreground"
              >
                {open === i ? t("regalica.chat.hideThinking") : t("regalica.chat.showThinking")}
              </button>
            ) : null}
            {technique && open === i && turn.reasoning ? (
              <p className="mt-2 whitespace-pre-wrap border-s-2 border-border ps-3 font-mono text-[11px] text-muted-foreground">
                {turn.reasoning}
              </p>
            ) : null}
            {technique && turn.signale && turn.signale.length > 0 ? (
              <ul className="mt-2 border-s-2 border-signal-warn ps-3 text-[11px] text-muted-foreground">
                {turn.signale.map((d, k) => (
                  <li key={k}>{d}</li>
                ))}
              </ul>
            ) : null}
            {/*
             * Le pouce du comptable.
             *
             * C'est lui qui construit la banque de cas : en quelques semaines
             * d'usage réel, on a cinquante cas — les vrais, ceux qu'on pose —
             * sans avoir écrit une question à froid.
             */}
            {technique && turn.role === "assistant" && turn.messageId ? (
              <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2">
                {juges[turn.messageId] ? (
                  <span className="text-[11px] text-muted-foreground">
                    {juges[turn.messageId] === "juste"
                      ? t("regalica.juge.merci.juste")
                      : t("regalica.juge.merci.faux")}
                  </span>
                ) : (
                  <>
                    <span className="text-[11px] text-muted-foreground">
                      {t("regalica.juge.invite")}
                    </span>
                    <button
                      type="button"
                      onClick={() => marquer(turn.messageId!, "juste")}
                      className="border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
                    >
                      {t("regalica.juge.juste")}
                    </button>
                    <button
                      type="button"
                      onClick={() => marquer(turn.messageId!, "faux")}
                      className="border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
                    >
                      {t("regalica.juge.faux")}
                    </button>
                  </>
                )}
              </div>
            ) : null}
            {technique && turn.meta ? (
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
