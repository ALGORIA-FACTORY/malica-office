import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { usePme } from "@/components/regalica/pme-context";
import {
  EmptyState,
  RegalicaVoice,
  SectionTitle,
  SignalDot,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import type { Piece } from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/coffre")({
  head: () => ({
    meta: [
      { title: "Coffre — Regalica Office" },
      {
        name: "description",
        content:
          "Le coffre de la PME : ce qui reste personnel, ce qui est partagé avec le cabinet. La cloison est tenue par la base, pas par l'affichage.",
      },
      { property: "og:title", content: "Coffre — Regalica Office" },
      {
        property: "og:description",
        content: "Personnel ou partagé : chaque bascule est journalisée.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeCoffre,
});

function PmeCoffre() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"partage" | "personnel">("partage");

  const pieces = useQuery({
    queryKey: ["pieces", pme.tenantId],
    queryFn: () => office().capture.list(pme.tenantId),
  });

  const toggle = useMutation({
    mutationFn: (piece: Piece) =>
      office().collab.setPieceVis(
        piece.id,
        piece.vis === "partage" ? "personnel" : "partage",
      ),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  const list = pieces.data ?? [];
  const shared = list.filter((p) => p.vis === "partage");
  const personal = list.filter((p) => p.vis === "personnel");
  const visible = tab === "partage" ? shared : personal;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" }).format(
      new Date(iso),
    );

  return (
    <div className="space-y-6">
      <RegalicaVoice
        greeting={t("pme.coffre.title")}
        sentence={t("pme.coffre.voice", { shared: shared.length, personal: personal.length })}
      />

      <div className="grid grid-cols-2 border border-border">
        {(["partage", "personnel"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide " +
              (tab === key ? "bg-foreground text-background" : "bg-card hover:bg-accent")
            }
          >
            {t(`pme.coffre.tab.${key}`)} · {key === "partage" ? shared.length : personal.length}
          </button>
        ))}
      </div>

      {error ? (
        <p className="border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12px]">
          {error}
        </p>
      ) : null}

      <SectionTitle>{t(`pme.coffre.tab.${tab}`)}</SectionTitle>

      {pieces.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : visible.length === 0 ? (
        <EmptyState>{t("pme.coffre.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {visible.map((piece) => {
            const locked = piece.status === "comptabilisee" || piece.status === "supervisee";
            return (
              <li key={piece.id} className="flex items-center gap-3 px-3 py-3">
                <SignalDot tone={piece.status === "retournee" ? "stop" : "neutral"} />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/pme/piece/$pieceId"
                    params={{ pieceId: piece.id }}
                    className="block truncate text-[13px] font-medium underline-offset-4 hover:underline"
                  >
                    {t(`pme.status.${piece.status}`)} · {piece.source.toUpperCase()}
                  </Link>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {fmt(piece.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={locked && piece.vis === "partage"}
                  onClick={() => toggle.mutate(piece)}
                  className="shrink-0 border border-border px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-accent disabled:opacity-40"
                >
                  {piece.vis === "partage"
                    ? t("pme.coffre.action.keep")
                    : t("pme.coffre.action.share")}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] italic text-muted-foreground">{t("pme.coffre.wall")}</p>
    </div>
  );
}
