/**
 * Les notifications de la PME — ce que le cabinet et Regalica lui disent.
 *
 * Chaque genre a sa phrase dans le dictionnaire ; ce que la notification
 * porte en plus — le titre d'un procès-verbal, le nom du cabinet, le sujet
 * d'une question — se montre tel que la base l'a rangé. Rien n'est composé
 * ici : un genre inconnu se lit « un événement du dossier », jamais un code.
 */
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
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
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

/** Les genres que la base pose sur le dossier d'une PME, et leur phrase. */
const GENRES: Record<string, MessageKey> = {
  "piece.retournee": "notif.kind.piece.retournee",
  "piece.validee": "notif.kind.piece.validee",
  "piece.partagee": "notif.kind.piece.partagee",
  "pv.envoye": "notif.kind.pv.envoye",
  "mandat.propose": "notif.kind.mandat.propose",
  "mandat.accepte": "notif.kind.mandat.accepte",
  "mandat.refuse": "notif.kind.mandat.refuse",
  "conseil.arbitrage": "notif.kind.conseil.arbitrage",
  "conseil.repondu": "notif.kind.conseil.repondu",
  "conseil.decide": "notif.kind.conseil.decide",
};

const OU = "routes/_authenticated/pme.notifications";

function chaine(payload: Record<string, unknown>, cle: string): string | null {
  const v = payload[cle];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * Ce que la notification porte en plus de son genre : un titre de PV et le
 * cabinet qui l'envoie, le cabinet qui propose, le sujet d'une question, la
 * note d'un retour. Tel que rangé, jamais recomposé.
 */
function detailDe(kind: string, payload: Record<string, unknown>): string | null {
  if (kind === "pv.envoye") {
    return (
      [chaine(payload, "titre"), chaine(payload, "cabinet")].filter(Boolean).join(" · ") || null
    );
  }
  if (kind.startsWith("mandat.")) return chaine(payload, "cabinet");
  if (kind.startsWith("conseil.")) return chaine(payload, "theme");
  return chaine(payload, "note");
}

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

  const kindLabel = (kind: string) => t(GENRES[kind] ?? "cab.notif.kind.autre");

  const rows = notifs.data ?? [];
  const unread = rows.filter((n) => !n.readAt).length;
  const panne = notifs.error ?? read.error;

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

      {panne ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {texteDeLErreur(panne, OU, t("common.error"))}
        </p>
      ) : null}

      {notifs.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : notifs.isError ? null : rows.length === 0 ? (
        <EmptyState>{t("pme.notifs.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {rows.map((n) => {
            const payload = (n.payload ?? {}) as Record<string, unknown>;
            const pieceId = chaine(payload, "piece_id");
            const detail = detailDe(n.kind, payload);
            const returned = n.kind === "piece.retournee";
            return (
              <li key={n.id} className="flex items-start gap-3 px-3 py-3">
                <span className="pt-1">
                  <SignalDot tone={returned ? "stop" : n.readAt ? "neutral" : "ok"} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[13px] font-medium">{kindLabel(n.kind)}</p>
                  {detail ? <p className="text-[12px] text-muted-foreground">{detail}</p> : null}
                  <p className="num text-[11px] text-muted-foreground">{fmt(n.createdAt)}</p>
                  {n.kind === "mandat.propose" ? (
                    <Link
                      to="/pme"
                      className="inline-block text-[11px] underline underline-offset-4"
                    >
                      {t("pme.mandat.accepter")}
                    </Link>
                  ) : null}
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
                    disabled={read.isPending}
                    onClick={() => read.mutate(n.id)}
                    className="shrink-0 border border-border px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-accent disabled:opacity-40"
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
