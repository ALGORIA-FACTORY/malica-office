import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { ClientPicker } from "@/components/regalica/ClientPicker";
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
import type { Asset } from "@/verticals/regalica-office/ports/repositories";
import {
  computeAmortissement,
  computeDepreciation,
  cumulAt,
  vncNette,
} from "@/verticals/regalica-office/socle/engines/immo/amortissement";

export const Route = createFileRoute("/_authenticated/cabinet/immobilisations")({
  head: () => ({
    meta: [
      { title: "Immobilisations — Regalica Office" },
      { name: "description", content: "Fiches d'immobilisation, dotations d'amortissement et dépréciations calculées par le Socle." },
      { property: "og:title", content: "Immobilisations — Regalica Office" },
      { property: "og:description", content: "Fiches d'immobilisation, dotations d'amortissement et dépréciations calculées par le Socle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetImmobilisations,
});

const FIELD = "border border-border bg-background px-2 py-1 text-[13px] outline-none";
const LABEL = "block text-[10px] uppercase tracking-wide text-muted-foreground";

interface AssetForm {
  id: string | null;
  categoryId: string;
  label: string;
  miseEnService: string;
  valeurBrute: string;
  valeurResiduelle: string;
  method: "lineaire" | "degressif";
  dureeAnnees: number;
  coefficient: string;
  status: "en_service" | "cede" | "rebute";
}

function emptyForm(): AssetForm {
  return {
    id: null,
    categoryId: "",
    label: "",
    miseEnService: new Date().toISOString().slice(0, 10),
    valeurBrute: "",
    valeurResiduelle: "0",
    method: "lineaire",
    dureeAnnees: 1,
    coefficient: "1",
    status: "en_service",
  };
}

function fromAsset(a: Asset): AssetForm {
  return {
    id: a.id,
    categoryId: a.categoryId,
    label: a.label,
    miseEnService: a.miseEnService,
    valeurBrute: a.valeurBrute,
    valeurResiduelle: a.valeurResiduelle,
    method: a.method,
    dureeAnnees: a.dureeAnnees,
    coefficient: a.coefficient,
    status: a.status,
  };
}

function CabinetImmobilisations() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [form, setForm] = useState<AssetForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const rows = clients.data ?? [];
  const client = rows.find((c) => c.tenantId === tenantId) ?? rows[0] ?? null;

  const pack = useQuery({
    queryKey: ["pack", client?.jurisdiction],
    queryFn: () => office().referential.activePack(client!.jurisdiction),
    enabled: !!client,
  });
  const params = useQuery({
    queryKey: ["socle-params", pack.data?.id],
    queryFn: () => office().referential.socleParams(pack.data!.id),
    enabled: !!pack.data,
  });
  const categories = useQuery({
    queryKey: ["immo-categories", pack.data?.id],
    queryFn: () => office().immo.categories(pack.data!.id),
    enabled: !!pack.data,
  });
  const assets = useQuery({
    queryKey: ["immo-assets", client?.tenantId],
    queryFn: () => office().immo.listAssets(client!.tenantId),
    enabled: !!client,
  });
  const dotations = useQuery({
    queryKey: ["immo-dotations", client?.tenantId],
    queryFn: () => office().immo.dotations(client!.tenantId),
    enabled: !!client,
  });
  const depreciations = useQuery({
    queryKey: ["immo-depreciations", client?.tenantId],
    queryFn: () => office().immo.depreciations(client!.tenantId),
    enabled: !!client,
  });

  const assetRows = assets.data ?? [];
  const asset = assetRows.find((a) => a.id === assetId) ?? assetRows[0] ?? null;
  const decimals = params.data?.moneyDecimals ?? 3;

  const assetDotations = (dotations.data ?? []).filter((d) => d.assetId === asset?.id);
  const assetDepreciations = (depreciations.data ?? []).filter((d) => d.assetId === asset?.id);
  const recorded = new Set(assetDotations.map((d) => `${d.exercice}`));
  const cumulDepreciation =
    assetDepreciations.length > 0
      ? assetDepreciations[assetDepreciations.length - 1]!.cumul
      : "0";

  // Le plan sort du Socle : durée, coefficient et décimales viennent du pack.
  const plan = useMemo(() => {
    if (!asset || !params.data || !client) return null;
    return computeAmortissement({
      currency: client.currency,
      decimals: params.data.moneyDecimals,
      method: asset.method,
      dureeAnnees: asset.dureeAnnees,
      coefficient: asset.coefficient,
      valeurBrute: asset.valeurBrute,
      valeurResiduelle: asset.valeurResiduelle,
      miseEnService: asset.miseEnService,
    });
  }, [asset, params.data, client]);

  // ------------------------------------------------------------ dépréciation
  const [depAt, setDepAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [recouvrable, setRecouvrable] = useState("");
  const [depNote, setDepNote] = useState("");

  const vncAmortie = plan
    ? vncNette({
        decimals,
        vncAmortie: (() => {
          const cumul = cumulAt(plan, depAt);
          const ligne = plan.lignes.find((l) => l.cumul === cumul);
          return ligne ? ligne.vnc : plan.valeur_brute;
        })(),
        cumulDepreciation: "0",
      })
    : "0";

  const vncNetteValue = plan
    ? vncNette({ decimals, vncAmortie, cumulDepreciation: cumulDepreciation })
    : "0";

  const depreciation =
    plan && client && recouvrable.trim() !== ""
      ? computeDepreciation({
          currency: client.currency,
          decimals,
          at: depAt,
          vnc: vncNetteValue,
          valeurRecouvrable: recouvrable,
          cumulAvant: cumulDepreciation,
        })
      : null;

  // --------------------------------------------------- écritures du Socle
  const ecritureIds = [
    ...assetDotations.map((d) => d.ecritureId),
    ...assetDepreciations.map((d) => d.ecritureId ?? null),
  ].filter((id): id is string => !!id);

  const ecritures = useQuery({
    queryKey: ["immo-ecritures", asset?.id, ecritureIds.join(",")],
    queryFn: () => office().office.ecrituresByIds(ecritureIds),
    enabled: ecritureIds.length > 0,
  });

  // ------------------------------------------------------------- mutations
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["immo-assets", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["immo-dotations", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["immo-depreciations", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["immo-ecritures"] });
  };

  const saveAsset = useMutation({
    mutationFn: async (input: AssetForm) => {
      if (!client || !pack.data) throw new Error("client.missing");
      if (input.id) {
        await office().immo.updateAsset({
          id: input.id,
          label: input.label,
          miseEnService: input.miseEnService,
          valeurBrute: input.valeurBrute,
          valeurResiduelle: input.valeurResiduelle,
          method: input.method,
          dureeAnnees: input.dureeAnnees,
          coefficient: input.coefficient,
          status: input.status,
        });
        return input.id;
      }
      return office().immo.createAsset({
        tenantId: client.tenantId,
        entityId: null,
        categoryId: input.categoryId,
        label: input.label,
        miseEnService: input.miseEnService,
        valeurBrute: input.valeurBrute,
        valeurResiduelle: input.valeurResiduelle,
        method: input.method,
        dureeAnnees: input.dureeAnnees,
        coefficient: input.coefficient,
        devise: client.currency,
        packVersionId: pack.data.id,
      });
    },
    onSuccess: (id) => {
      setForm(null);
      setError(null);
      setAssetId(id);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const record = useMutation({
    mutationFn: async (exercice: number) => {
      const ligne = plan?.lignes.find((l) => l.exercice === exercice);
      if (!ligne || !asset || !pack.data) throw new Error("plan.missing");
      return office().immo.constaterDotation({
        assetId: asset.id,
        exercice: ligne.exercice,
        months: ligne.months,
        dotation: ligne.dotation,
        cumul: ligne.cumul,
        vnc: ligne.vnc,
        packVersionId: pack.data.id,
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const recordDep = useMutation({
    mutationFn: async () => {
      if (!asset || !pack.data || !depreciation) throw new Error("depreciation.missing");
      return office().immo.constaterDepreciation({
        assetId: asset.id,
        at: depreciation.at,
        vnc: depreciation.vnc,
        valeurRecouvrable: depreciation.valeur_recouvrable,
        mouvement: depreciation.mouvement,
        cumul: depreciation.cumul_apres,
        packVersionId: pack.data.id,
        note: depNote.trim() || null,
      });
    },
    onSuccess: () => {
      setRecouvrable("");
      setDepNote("");
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.immo.voice")}</RegalicaNote>, [locale]);

  useEffect(() => {
    setForm(null);
    setError(null);
  }, [client?.tenantId]);

  const canEdit = assetDotations.length === 0;
  const categoryRows = categories.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t("cab.immo.title")}</h1>

      {rows.length === 0 ? (
        <EmptyState>{t("cab.clients.empty")}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <ClientPicker
              label={t("cab.queue.client")}
              clients={rows}
              value={client?.tenantId ?? null}
              onChange={(id) => {
                setTenantId(id);
                setAssetId(null);
              }}
            />
            <ActionButton onClick={() => setForm(emptyForm())}>
              {t("cab.immo.new")}
            </ActionButton>
          </div>

          {error ? (
            <p className="border border-destructive px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          ) : null}

          {form ? (
            <form
              className="space-y-4 border border-border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveAsset.mutate(form);
              }}
            >
              <SectionTitle>{form.id ? t("cab.immo.edit") : t("cab.immo.new")}</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.immo.category")}</span>
                  <select
                    className={`${FIELD} w-full`}
                    value={form.categoryId}
                    disabled={!!form.id}
                    required
                    onChange={(e) => {
                      const cat = categoryRows.find((c) => c.id === e.target.value);
                      setForm({
                        ...form,
                        categoryId: e.target.value,
                        // Méthode, durée et coefficient viennent du pack, jamais d'une saisie libre.
                        method: cat?.method ?? form.method,
                        dureeAnnees: cat?.dureeAnnees ?? form.dureeAnnees,
                        coefficient: cat?.coefficient ?? form.coefficient,
                      });
                    }}
                  >
                    <option value="">—</option>
                    {categoryRows.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.immo.asset")}</span>
                  <input
                    className={`${FIELD} w-full`}
                    value={form.label}
                    required
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.immo.mes")}</span>
                  <input
                    type="date"
                    className={`${FIELD} num w-full`}
                    value={form.miseEnService}
                    required
                    onChange={(e) => setForm({ ...form, miseEnService: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.immo.vb")}</span>
                  <input
                    inputMode="decimal"
                    className={`${FIELD} num w-full`}
                    value={form.valeurBrute}
                    required
                    onChange={(e) => setForm({ ...form, valeurBrute: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.immo.vr")}</span>
                  <input
                    inputMode="decimal"
                    className={`${FIELD} num w-full`}
                    value={form.valeurResiduelle}
                    required
                    onChange={(e) => setForm({ ...form, valeurResiduelle: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.immo.status")}</span>
                  <select
                    className={`${FIELD} w-full`}
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as AssetForm["status"] })
                    }
                  >
                    <option value="en_service">{t("cab.immo.status.en_service")}</option>
                    <option value="cede">{t("cab.immo.status.cede")}</option>
                    <option value="rebute">{t("cab.immo.status.rebute")}</option>
                  </select>
                </label>
              </div>
              <p className="num text-[11px] text-muted-foreground">
                {t("cab.immo.fromPack", {
                  method: t(`cab.immo.method.${form.method}`),
                  duree: form.dureeAnnees,
                  coefficient: form.coefficient,
                })}
              </p>
              <div className="flex gap-2">
                <ActionButton type="submit" disabled={saveAsset.isPending}>
                  {t("cab.immo.save")}
                </ActionButton>
                <button
                  type="button"
                  className="border border-border px-3 py-1 text-[11px] uppercase tracking-wide"
                  onClick={() => setForm(null)}
                >
                  {t("cab.immo.cancel")}
                </button>
              </div>
            </form>
          ) : null}

          <SectionTitle>{t("cab.immo.assets")}</SectionTitle>
          {assetRows.length === 0 ? (
            <EmptyState>{t("cab.immo.empty")}</EmptyState>
          ) : (
            <InkTable
              caption={t("cab.immo.assets")}
              head={[
                t("cab.immo.asset"),
                t("cab.immo.mes"),
                t("cab.immo.method"),
                t("cab.immo.duree"),
                t("cab.immo.vb"),
                t("cab.immo.status"),
                "",
              ]}
            >
              {assetRows.map((a) => (
                <InkTableRow key={a.id}>
                  <InkCell>{a.label}</InkCell>
                  <InkCell numeric>{a.miseEnService}</InkCell>
                  <InkCell>{t(`cab.immo.method.${a.method}`)}</InkCell>
                  <InkCell numeric>{a.dureeAnnees}</InkCell>
                  <InkCell numeric>
                    {a.valeurBrute} {a.devise}
                  </InkCell>
                  <InkCell>{t(`cab.immo.status.${a.status}`)}</InkCell>
                  <InkCell>
                    <span className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setAssetId(a.id);
                          setForm(null);
                        }}
                        className="text-[11px] uppercase tracking-wide underline"
                      >
                        {t("cab.immo.plan")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAssetId(a.id);
                          setForm(fromAsset(a));
                        }}
                        className="text-[11px] uppercase tracking-wide underline"
                      >
                        {t("cab.immo.edit")}
                      </button>
                    </span>
                  </InkCell>
                </InkTableRow>
              ))}
            </InkTable>
          )}

          {plan && asset ? (
            <>
              <section className="space-y-3">
                <SectionTitle>
                  {t("cab.immo.plan")} — {asset.label}
                </SectionTitle>
                {!canEdit ? (
                  <p className="text-[11px] text-muted-foreground">{t("cab.immo.locked")}</p>
                ) : null}
                <InkTable
                  caption={t("cab.immo.plan")}
                  head={[
                    t("cab.immo.exercice"),
                    t("cab.immo.months"),
                    t("cab.immo.base"),
                    t("cab.immo.dotation"),
                    t("cab.immo.cumul"),
                    t("cab.immo.vnc"),
                    "",
                  ]}
                >
                  {plan.lignes.map((l) => (
                    <InkTableRow key={l.exercice}>
                      <InkCell numeric>{l.exercice}</InkCell>
                      <InkCell numeric>{l.months}</InkCell>
                      <InkCell numeric>{l.base}</InkCell>
                      <InkCell numeric>{l.dotation}</InkCell>
                      <InkCell numeric>{l.cumul}</InkCell>
                      <InkCell numeric>{l.vnc}</InkCell>
                      <InkCell>
                        {recorded.has(`${l.exercice}`) ? (
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {t("cab.immo.recorded")}
                          </span>
                        ) : (
                          <ActionButton
                            onClick={() => record.mutate(l.exercice)}
                            disabled={record.isPending}
                          >
                            {t("cab.immo.record")}
                          </ActionButton>
                        )}
                      </InkCell>
                    </InkTableRow>
                  ))}
                </InkTable>
                <p className="num text-[11px] text-muted-foreground">
                  {t("cab.immo.totals", {
                    dotations: plan.totals.dotations,
                    vnc: plan.totals.vnc_finale,
                    currency: plan.currency,
                  })}
                </p>
              </section>

              <section className="space-y-3">
                <SectionTitle>{t("cab.immo.dep.title")}</SectionTitle>
                <div className="flex flex-wrap items-end gap-3 border border-border p-4">
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.immo.dep.at")}</span>
                    <input
                      type="date"
                      className={`${FIELD} num`}
                      value={depAt}
                      onChange={(e) => setDepAt(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.immo.dep.vnc")}</span>
                    <span className={`${FIELD} num block bg-muted`}>{vncNetteValue}</span>
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.immo.dep.recouvrable")}</span>
                    <input
                      inputMode="decimal"
                      className={`${FIELD} num`}
                      value={recouvrable}
                      onChange={(e) => setRecouvrable(e.target.value)}
                    />
                  </label>
                  <label className="grow space-y-1">
                    <span className={LABEL}>{t("cab.immo.dep.note")}</span>
                    <input
                      className={`${FIELD} w-full`}
                      value={depNote}
                      onChange={(e) => setDepNote(e.target.value)}
                    />
                  </label>
                  <ActionButton
                    onClick={() => recordDep.mutate()}
                    disabled={!depreciation || depreciation.mouvement === "0" || recordDep.isPending}
                  >
                    {depreciation && Number(depreciation.mouvement) < 0
                      ? t("cab.immo.dep.reprise")
                      : t("cab.immo.dep.record")}
                  </ActionButton>
                </div>
                {depreciation ? (
                  <p className="num text-[11px] text-muted-foreground">
                    {t("cab.immo.dep.result", {
                      mouvement: depreciation.mouvement,
                      cumul: depreciation.cumul_apres,
                      currency: depreciation.currency,
                    })}
                  </p>
                ) : null}
                {assetDepreciations.length > 0 ? (
                  <InkTable
                    caption={t("cab.immo.dep.title")}
                    head={[
                      t("cab.immo.dep.at"),
                      t("cab.immo.dep.vnc"),
                      t("cab.immo.dep.recouvrable"),
                      t("cab.immo.dep.mouvement"),
                      t("cab.immo.cumul"),
                      t("cab.immo.dep.note"),
                    ]}
                  >
                    {assetDepreciations.map((d) => (
                      <InkTableRow key={d.id}>
                        <InkCell numeric>{d.at}</InkCell>
                        <InkCell numeric>{d.vnc}</InkCell>
                        <InkCell numeric>{d.valeurRecouvrable}</InkCell>
                        <InkCell numeric>{d.mouvement}</InkCell>
                        <InkCell numeric>{d.cumul}</InkCell>
                        <InkCell>{d.note ?? "—"}</InkCell>
                      </InkTableRow>
                    ))}
                  </InkTable>
                ) : (
                  <EmptyState>{t("cab.immo.dep.empty")}</EmptyState>
                )}
              </section>

              <section className="space-y-3">
                <SectionTitle>{t("cab.immo.ecritures")}</SectionTitle>
                {(ecritures.data ?? []).length === 0 ? (
                  <EmptyState>{t("cab.immo.ecritures.empty")}</EmptyState>
                ) : (
                  (ecritures.data ?? []).map((e) => (
                    <article key={e.id} className="space-y-2 border border-border p-4">
                      <header className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-[13px] font-semibold">{e.libelle}</h3>
                        <p className="num text-[11px] text-muted-foreground">
                          {e.journal} · {e.dateEcriture} · {t(
                            e.status === "booked"
                              ? "cab.immo.ecriture.booked"
                              : e.status === "supervisee"
                                ? "cab.immo.ecriture.supervisee"
                                : "cab.immo.ecriture.proposee",
                          )}
                        </p>
                      </header>
                      <InkTable
                        caption={e.libelle}
                        head={[
                          t("cab.immo.ecriture.account"),
                          t("cab.immo.ecriture.libelle"),
                          t("cab.immo.ecriture.debit"),
                          t("cab.immo.ecriture.credit"),
                        ]}
                      >
                        {e.lines.map((l) => (
                          <InkTableRow key={l.ordinal}>
                            <InkCell numeric>{l.accountCode}</InkCell>
                            <InkCell>{l.libelle}</InkCell>
                            <InkCell numeric>{l.debit}</InkCell>
                            <InkCell numeric>{l.credit}</InkCell>
                          </InkTableRow>
                        ))}
                      </InkTable>
                    </article>
                  ))
                )}
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
