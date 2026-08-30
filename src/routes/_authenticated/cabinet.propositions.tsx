import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  ActionButton,
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionTitle,
  SignalDot,
  StickyActions,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/propositions")({
  head: () => ({
    meta: [
      { title: "Propositions à superviser — Regalica Office" },
      {
        name: "description",
        content:
          "File des écritures comptabilisées en attente de supervision, avec validation en masse ou retour motivé pièce par pièce.",
      },
      { property: "og:title", content: "Propositions à superviser — Regalica Office" },
      {
        property: "og:description",
        content: "Validation en masse ou retour motivé, chaque geste au journal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetPropositions,
});

function CabinetPropositions() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const queue = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });

  const rows = (queue.data ?? []).filter((q) => q.status === "comptabilisee" && q.ecritureId);
  const chosen = rows.filter((r) => selected[r.pieceId]);

  const bulk = useMutation({
    mutationFn: async () => {
      let count = 0;
      for (const item of chosen) {
        if (!item.ecritureId) continue;
        await office().supervision.review({ ecritureId: item.ecritureId, outcome: "valide" });
        count += 1;
      }
      return count;
    },
    onSuccess: async (count) => {
      setError(null);
      setDone(count);
      setSelected({});
      await qc.invalidateQueries({ queryKey: ["cab-queue", org.id] });
      await qc.invalidateQueries({ queryKey: ["cab-clients", org.id] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  useRegalicaPanel(
    <RegalicaNote kicker={t("cab.prop.panel.kicker")}>
      {t("cab.prop.panel", { count: rows.length })}
    </RegalicaNote>,
    [rows.length],
  );

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("cab.prop.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.prop.lede")}</p>
      </div>

      {error ? (
        <p className="border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12px]">
          {error}
        </p>
      ) : null}
      {done !== null ? (
        <p className="border border-s-2 border-border border-s-signal-go bg-card px-3 py-2 text-[12px]">
          {t("cab.prop.done", { count: done })}
        </p>
      ) : null}

      <section className="space-y-3">
        <SectionTitle
          action={
            <button
              type="button"
              onClick={() =>
                setSelected(
                  chosen.length === rows.length
                    ? {}
                    : Object.fromEntries(rows.map((r) => [r.pieceId, true])),
                )
              }
              className="text-[10px] uppercase tracking-wide underline underline-offset-4"
            >
              {chosen.length === rows.length && rows.length > 0
                ? t("cab.prop.none")
                : t("cab.prop.all")}
            </button>
          }
        >
          {t("cab.prop.queue")}
        </SectionTitle>

        {queue.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.prop.empty")}</EmptyState>
        ) : (
          <InkTable
            head={[
              "",
              t("cab.prop.col.client"),
              t("cab.prop.col.libelle"),
              t("cab.prop.col.date"),
              t("cab.prop.col.open"),
            ]}
          >
            {rows.map((r) => (
              <InkTableRow key={r.pieceId}>
                <InkCell>
                  <input
                    type="checkbox"
                    checked={Boolean(selected[r.pieceId])}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [r.pieceId]: e.target.checked }))
                    }
                    aria-label={r.libelle ?? r.pieceId}
                  />
                </InkCell>
                <InkCell>
                  <span className="inline-flex items-center gap-2">
                    <SignalDot tone="neutral" />
                    {r.clientName}
                  </span>
                </InkCell>
                <InkCell>{r.libelle ?? "—"}</InkCell>
                <InkCell numeric>{fmt(r.dateEcriture ?? r.createdAt)}</InkCell>
                <InkCell>
                  <Link
                    to="/cabinet/piece/$pieceId"
                    params={{ pieceId: r.pieceId }}
                    className="text-[12px] underline underline-offset-4"
                  >
                    {t("cab.prop.review")}
                  </Link>
                </InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        )}
      </section>

      {rows.length > 0 ? (
        <StickyActions>
          <span className="me-auto text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("cab.prop.selected", { count: chosen.length })}
          </span>
          <ActionButton
            variant="ink"
            onClick={() => bulk.mutate()}
            disabled={chosen.length === 0 || bulk.isPending}
          >
            {bulk.isPending ? t("common.loading") : t("cab.prop.validate")}
          </ActionButton>
        </StickyActions>
      ) : null}

      <p className="text-[10px] italic text-muted-foreground">{t("cab.prop.note")}</p>
    </div>
  );
}
