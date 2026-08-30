import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  ActionButton,
  EmptyState,
  RegalicaNote,
  SectionTitle,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/pv")({
  head: () => ({
    meta: [
      { title: "PV de réunion — Regalica Office" },
      {
        name: "description",
        content:
          "Comptes rendus de réunion du cabinet : participants, ordre du jour, décisions, conservés par dossier client.",
      },
      { property: "og:title", content: "PV de réunion — Regalica Office" },
      {
        property: "og:description",
        content: "Participants, ordre du jour, décisions : consignés, jamais effacés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetPv,
});

function CabinetPv() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    clientTenantId: "",
    at: new Date().toISOString().slice(0, 10),
    titre: "",
    participants: "",
    ordreDuJour: "",
    decisions: "",
  });
  const [error, setError] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const pv = useQuery({
    queryKey: ["cab-pv", org.id],
    queryFn: () => office().collab.pvList(org.id),
  });

  const create = useMutation({
    mutationFn: () =>
      office().collab.addPv({
        cabinetTenantId: org.id,
        clientTenantId: form.clientTenantId || null,
        at: form.at,
        titre: form.titre.trim(),
        participants: form.participants.trim() || null,
        ordreDuJour: form.ordreDuJour.trim() || null,
        decisions: form.decisions.trim() || null,
      }),
    onSuccess: async () => {
      setError(null);
      setForm((f) => ({ ...f, titre: "", participants: "", ordreDuJour: "", decisions: "" }));
      await qc.invalidateQueries({ queryKey: ["cab-pv", org.id] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  const rows = pv.data ?? [];
  const nameOf = (id: string | null) =>
    id ? ((clients.data ?? []).find((c) => c.tenantId === id)?.name ?? id.slice(0, 8)) : "—";
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  useRegalicaPanel(
    <RegalicaNote kicker={t("cab.pv.panel.kicker")}>
      {t("cab.pv.panel", { count: rows.length })}
    </RegalicaNote>,
    [rows.length],
  );

  const field =
    "w-full border border-border bg-background px-2 py-2 text-[13px] normal-case tracking-normal text-foreground";
  const label = "block space-y-1 text-[11px] uppercase tracking-wide text-muted-foreground";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("cab.pv.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.pv.lede")}</p>
      </div>

      <section className="space-y-3 border border-border bg-card p-4">
        <SectionTitle>{t("cab.pv.new")}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            {t("cab.pv.client")}
            <select
              value={form.clientTenantId}
              onChange={(e) => setForm((f) => ({ ...f, clientTenantId: e.target.value }))}
              className={field}
            >
              <option value="">—</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.tenantId} value={c.tenantId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {t("cab.pv.date")}
            <input
              type="date"
              value={form.at}
              onChange={(e) => setForm((f) => ({ ...f, at: e.target.value }))}
              className={field}
            />
          </label>
          <label className={label}>
            {t("cab.pv.subject")}
            <input
              value={form.titre}
              onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))}
              className={field}
            />
          </label>
        </div>
        <label className={label}>
          {t("cab.pv.participants")}
          <input
            value={form.participants}
            onChange={(e) => setForm((f) => ({ ...f, participants: e.target.value }))}
            className={field}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {t("cab.pv.agenda")}
            <textarea
              rows={3}
              value={form.ordreDuJour}
              onChange={(e) => setForm((f) => ({ ...f, ordreDuJour: e.target.value }))}
              className={field}
            />
          </label>
          <label className={label}>
            {t("cab.pv.decisions")}
            <textarea
              rows={3}
              value={form.decisions}
              onChange={(e) => setForm((f) => ({ ...f, decisions: e.target.value }))}
              className={field}
            />
          </label>
        </div>
        {error ? (
          <p className="border border-s-2 border-border border-s-signal-stop px-3 py-2 text-[12px]">
            {error}
          </p>
        ) : null}
        <ActionButton
          variant="ink"
          onClick={() => create.mutate()}
          disabled={!form.titre.trim() || create.isPending}
        >
          {create.isPending ? t("common.loading") : t("cab.pv.save")}
        </ActionButton>
      </section>

      <section className="space-y-3">
        <SectionTitle>{t("cab.pv.history")}</SectionTitle>
        {pv.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.pv.empty")}</EmptyState>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="border border-border bg-card p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {fmt(row.at)} · {nameOf(row.clientTenantId)}
                </p>
                <p className="mt-1 text-[14px] font-medium">{row.titre}</p>
                {row.participants ? (
                  <p className="mt-2 text-[12px] text-muted-foreground">{row.participants}</p>
                ) : null}
                {row.ordreDuJour ? (
                  <p className="mt-2 whitespace-pre-line text-[13px]">{row.ordreDuJour}</p>
                ) : null}
                {row.decisions ? (
                  <p className="mt-2 whitespace-pre-line border-s-2 border-border ps-3 text-[13px]">
                    {row.decisions}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
