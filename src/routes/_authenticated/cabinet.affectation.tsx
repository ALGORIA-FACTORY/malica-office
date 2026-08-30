import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/affectation")({
  head: () => ({
    meta: [
      { title: "Affectation des clients — Regalica Office" },
      {
        name: "description",
        content:
          "Affecter chaque dossier client à un collaborateur du cabinet, avec briefing écrit et historique complet des réaffectations.",
      },
      { property: "og:title", content: "Affectation des clients — Regalica Office" },
      {
        property: "og:description",
        content: "Un dossier, un collaborateur, un briefing. Rien ne s'efface.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetAffectation,
});

function CabinetAffectation() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState("");
  const [briefing, setBriefing] = useState("");
  const [error, setError] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const members = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const assignments = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });

  const assign = useMutation({
    mutationFn: () =>
      office().collab.assign({
        cabinetTenantId: org.id,
        clientTenantId: clientId,
        collaboratorId: userId,
        briefing: briefing.trim() || null,
      }),
    onSuccess: async () => {
      setError(null);
      setBriefing("");
      await qc.invalidateQueries({ queryKey: ["cab-assignments", org.id] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  const rows = assignments.data ?? [];
  const active = rows.filter((a) => a.active);
  const clientName = (id: string) =>
    (clients.data ?? []).find((c) => c.tenantId === id)?.name ?? id.slice(0, 8);
  const memberName = (id: string) =>
    (members.data ?? []).find((m) => m.userId === id)?.email ?? id.slice(0, 8);

  useRegalicaPanel(
    <RegalicaNote>
      {t("cab.affect.panel", {
        assigned: active.length,
        total: (clients.data ?? []).length,
      })}
    </RegalicaNote>,
    [active.length, clients.data?.length],
  );

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("cab.affect.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.affect.lede")}</p>
      </div>

      <section className="space-y-3 border border-border bg-card p-4">
        <SectionTitle>{t("cab.affect.form")}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("cab.affect.client")}
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full border border-border bg-background px-2 py-2 text-[13px] normal-case tracking-normal text-foreground"
            >
              <option value="">—</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.tenantId} value={c.tenantId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("cab.affect.collaborator")}
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full border border-border bg-background px-2 py-2 text-[13px] normal-case tracking-normal text-foreground"
            >
              <option value="">—</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.email} · {m.role}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("cab.affect.briefing")}
          <textarea
            value={briefing}
            onChange={(e) => setBriefing(e.target.value)}
            rows={3}
            className="w-full border border-border bg-background px-2 py-2 text-[13px] normal-case tracking-normal text-foreground"
          />
        </label>
        {error ? (
          <p className="border border-s-2 border-border border-s-signal-stop px-3 py-2 text-[12px]">
            {error}
          </p>
        ) : null}
        <ActionButton
          onClick={() => assign.mutate()}
          disabled={!clientId || !userId || assign.isPending}
        >
          {assign.isPending ? t("common.loading") : t("cab.affect.submit")}
        </ActionButton>
      </section>

      <section className="space-y-3">
        <SectionTitle>{t("cab.affect.history")}</SectionTitle>
        {assignments.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.affect.empty")}</EmptyState>
        ) : (
          <InkTable
            head={[
              t("cab.affect.client"),
              t("cab.affect.collaborator"),
              t("cab.affect.briefing"),
              t("cab.affect.state"),
              t("cab.affect.date"),
            ]}
          >
            {rows.map((a) => (
              <InkTableRow key={a.id}>
                <InkCell>{clientName(a.clientTenantId)}</InkCell>
                <InkCell>{memberName(a.collaboratorId)}</InkCell>
                <InkCell>{a.briefing ?? "—"}</InkCell>
                <InkCell numeric>
                  {a.active ? t("cab.affect.active") : t("cab.affect.past")} · #{a.seq}
                </InkCell>
                <InkCell numeric>{fmt(a.createdAt)}</InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        )}
      </section>
    </div>
  );
}
