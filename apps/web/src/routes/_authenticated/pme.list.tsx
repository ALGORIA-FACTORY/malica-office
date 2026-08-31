import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { usePme } from "@/components/regalica/pme-context";
import { Chip, Timeline, type StepState } from "@/components/regalica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/regalica-office/composition";
import type { PieceStatus } from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/list")({
  head: () => ({
    meta: [
      { title: "Mes pièces — Regalica Office" },
      {
        name: "description",
        content: "Toutes mes pièces et leur état, de la capture à la comptabilisation.",
      },
      { property: "og:title", content: "Mes pièces — Regalica Office" },
      {
        property: "og:description",
        content: "Toutes mes pièces et leur état, de la capture à la comptabilisation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PiecesList,
});

const FILTERS: Array<PieceStatus | "all"> = [
  "all",
  "capturee",
  "lue",
  "proposee",
  "comptabilisee",
  "retournee",
];

const ORDER: PieceStatus[] = ["capturee", "lue", "comptabilisee"];

function stepState(status: PieceStatus, step: PieceStatus): StepState {
  const normalized: PieceStatus =
    status === "proposee" ? "lue" : status === "supervisee" ? "comptabilisee" : status;
  if (status === "retournee")
    return step === "capturee" ? "done" : step === "lue" ? "current" : "pending";
  const idx = ORDER.indexOf(normalized);
  const stepIdx = ORDER.indexOf(step);
  if (stepIdx < idx) return "done";
  if (stepIdx === idx) return "current";
  return "pending";
}

function PiecesList() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const [filter, setFilter] = useState<PieceStatus | "all">("all");

  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const rows = (pieces.data ?? []).filter((p) => filter === "all" || p.status === filter);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">{t("pme.list.title")}</h1>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? t("pme.filter.all") : t(`pme.status.${f}` as MessageKey)}
          </Chip>
        ))}
      </div>

      {pieces.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("pme.list.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                to="/pme/piece/$pieceId"
                params={{ pieceId: p.id }}
                className="block border border-border bg-card p-4 hover:bg-accent"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="num text-xs text-muted-foreground">
                    {p.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
                    {t(`pme.status.${p.status}` as MessageKey)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="truncate text-[14px] font-medium">
                    {p.emetteur ?? t("pme.list.nonLue")}
                  </span>
                  <span className="num flex-none text-[13px] font-medium">
                    {p.total === null ? "—" : montant(p.total, locale)}
                  </span>
                </div>
                <Timeline
                  steps={ORDER.map((s) => ({
                    key: s,
                    label: t(`pme.status.${s}` as MessageKey),
                    state: stepState(p.status, s),
                  }))}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          disabled={pme.capturing}
          onClick={() => pme.capture("photo")}
          className="border border-foreground bg-foreground px-4 py-4 text-xs uppercase tracking-wide text-background disabled:opacity-60"
        >
          {pme.capturing ? t("pme.capture.sending") : t("pme.capture.photo")}
        </button>
        <button
          type="button"
          disabled={pme.capturing}
          onClick={() => pme.capture("pdf")}
          className="border border-border bg-card px-4 py-4 text-xs uppercase tracking-wide hover:bg-accent disabled:opacity-60"
        >
          {t("pme.capture.pdf")}
        </button>
      </div>
    </div>
  );
}
