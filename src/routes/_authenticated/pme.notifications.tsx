import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { usePme } from "@/components/regalica/pme-context";
import {
  EmptyState,
  RegalicaVoice,
  SectionTitle,
  SignalDot,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Regalica Office" },
      {
        name: "description",
        content:
          "Les retours du cabinet et les validations, avec le motif gouverné et le lien vers la pièce concernée. Aucune notification-appât.",
      },
      { property: "og:title", content: "Notifications — Regalica Office" },
      {
        property: "og:description",
        content: "Retours motivés du cabinet et validations, rien d'autre.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeNotifications,
});

function PmeNotifications() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();

  const notifs = useQuery({
    queryKey: ["notifications", pme.tenantId],
    queryFn: () => office().collab.notifications([pme.tenantId]),
  });

  const read = useMutation({
    mutationFn: (id: string) => office().collab.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", pme.tenantId] }),
  });

  const kindLabel = (kind: string) => {
    if (kind === "piece.retournee") return t("notif.kind.piece.retournee");
    if (kind === "piece.validee") return t("notif.kind.piece.validee");
    if (kind === "piece.partagee") return t("notif.kind.piece.partagee");
    return kind;
  };

  const rows = notifs.data ?? [];
  const unread = rows.filter((n) => !n.readAt).length;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <RegalicaVoice
        greeting={t("pme.notifs.title")}
        sentence={
          rows.length === 0
            ? t("pme.notifs.voice.empty")
            : unread === 0
              ? t("pme.notifs.voice.clear")
              : t("pme.notifs.voice.unread", { count: unread })
        }
      />

      <SectionTitle>{t("pme.notifs.list")}</SectionTitle>

      {notifs.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState>{t("pme.notifs.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {rows.map((n) => {
            const payload = (n.payload ?? {}) as Record<string, unknown>;
            const pieceId = payload["piece_id"] as string | undefined;
            const note = payload["note"] as string | undefined;
            const returned = n.kind === "piece.retournee";
            return (
              <li key={n.id} className="flex items-start gap-3 px-3 py-3">
                <span className="pt-1">
                  <SignalDot tone={returned ? "stop" : n.readAt ? "neutral" : "ok"} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[13px] font-medium">{kindLabel(n.kind)}</p>
                  {note ? <p className="text-[12px] text-muted-foreground">{note}</p> : null}
                  <p className="font-mono text-[11px] text-muted-foreground">{fmt(n.createdAt)}</p>
                  {pieceId ? (
                    <Link
                      to="/pme/piece/$pieceId"
                      params={{ pieceId }}
                      className="inline-block text-[11px] underline underline-offset-4"
                    >
                      {t("pme.notifs.open")}
                    </Link>
                  ) : null}
                </div>
                {!n.readAt ? (
                  <button
                    type="button"
                    onClick={() => read.mutate(n.id)}
                    className="shrink-0 border border-border px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-accent"
                  >
                    {t("pme.notifs.markRead")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
