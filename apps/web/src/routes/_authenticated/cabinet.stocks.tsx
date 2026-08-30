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
import type { StockItem } from "@/verticals/regalica-office/ports/repositories";
import {
  computeStock,
  computeStockDepreciation,
  computeStockVariation,
} from "@/verticals/regalica-office/socle/engines/stock/valorisation";

export const Route = createFileRoute("/_authenticated/cabinet/stocks")({
  head: () => ({
    meta: [
      { title: "Stocks — Regalica Office" },
      {
        name: "description",
        content:
          "Articles, mouvements, valorisation CUMP et FIFO et dépréciations calculées par le Socle.",
      },
      { property: "og:title", content: "Stocks — Regalica Office" },
      {
        property: "og:description",
        content:
          "Articles, mouvements, valorisation CUMP et FIFO et dépréciations calculées par le Socle.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetStocks,
});

const FIELD = "border border-border bg-background px-2 py-1 text-[13px] outline-none";
const LABEL = "block text-[10px] uppercase tracking-wide text-muted-foreground";

interface ItemForm {
  id: string | null;
  categoryId: string;
  reference: string;
  designation: string;
  unite: string;
  methode: "cump" | "fifo";
  active: boolean;
}

function emptyItemForm(methode: "cump" | "fifo"): ItemForm {
  return {
    id: null,
    categoryId: "",
    reference: "",
    designation: "",
    unite: "u",
    methode,
    active: true,
  };
}

function fromItem(i: StockItem): ItemForm {
  return {
    id: i.id,
    categoryId: i.categoryId ?? "",
    reference: i.reference,
    designation: i.designation,
    unite: i.unite,
    methode: i.methode,
    active: i.active,
  };
}

interface MouvementForm {
  sens: "entree" | "sortie";
  at: string;
  quantite: string;
  coutUnitaire: string;
  reference: string;
}

function emptyMouvementForm(): MouvementForm {
  return {
    sens: "entree",
    at: new Date().toISOString().slice(0, 10),
    quantite: "",
    coutUnitaire: "",
    reference: "",
  };
}

function CabinetStocks() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemForm | null>(null);
  const [mouvement, setMouvement] = useState<MouvementForm>(emptyMouvementForm);
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
    queryKey: ["stock-categories", pack.data?.id],
    queryFn: () => office().stocks.categories(pack.data!.id),
    enabled: !!pack.data,
  });
  const items = useQuery({
    queryKey: ["stock-items", client?.tenantId],
    queryFn: () => office().stocks.listItems(client!.tenantId),
    enabled: !!client,
  });
  const itemRows = items.data ?? [];
  const item = itemRows.find((i) => i.id === itemId) ?? itemRows[0] ?? null;

  const mouvements = useQuery({
    queryKey: ["stock-mouvements", client?.tenantId, item?.id],
    queryFn: () => office().stocks.mouvements(client!.tenantId, item!.id),
    enabled: !!client && !!item,
  });
  const inventaires = useQuery({
    queryKey: ["stock-inventaires", client?.tenantId, item?.id],
    queryFn: () => office().stocks.inventaires(client!.tenantId, item!.id),
    enabled: !!client && !!item,
  });
  const depreciations = useQuery({
    queryKey: ["stock-depreciations", client?.tenantId, item?.id],
    queryFn: () => office().stocks.depreciations(client!.tenantId, item!.id),
    enabled: !!client && !!item,
  });

  const decimals = params.data?.moneyDecimals ?? 3;
  const inventaireRows = inventaires.data ?? [];
  const depreciationRows = depreciations.data ?? [];

  // La valorisation vient du Socle ; la méthode est celle du pack ou de l'article.
  const valo = useMemo(() => {
    if (!item || !params.data || !client || !mouvements.data) return null;
    try {
      return computeStock(
        {
          currency: item.devise || client.currency,
          decimals: params.data.moneyDecimals,
          quantiteDecimals: params.data.stockQuantiteDecimals,
          methode: item.methode ?? params.data.stockMethode,
        },
        mouvements.data.map((m) => ({
          at: m.at,
          sens: m.sens,
          quantite: m.quantite,
          cout_unitaire: m.coutUnitaire,
          reference: m.reference,
        })),
      );
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [item, params.data, client, mouvements.data]);

  // ------------------------------------------------------- variation d'inventaire
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10));

  const derniereFinale =
    inventaireRows.length > 0 ? inventaireRows[inventaireRows.length - 1]!.final : "0";

  const variation =
    valo && client
      ? computeStockVariation({
          currency: item?.devise || client.currency,
          decimals,
          period,
          initial: derniereFinale,
          final: valo.totals.valeur,
        })
      : null;

  const periodeDejaConstatee = inventaireRows.some((i) => i.period === period);

  // ------------------------------------------------------------- dépréciation
  const [depAt, setDepAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [valeurNette, setValeurNette] = useState("");
  const [depNote, setDepNote] = useState("");

  const cumulDepreciation =
    depreciationRows.length > 0 ? depreciationRows[depreciationRows.length - 1]!.cumul : "0";

  const depreciation =
    valo && client && valeurNette.trim() !== ""
      ? computeStockDepreciation({
          currency: item?.devise || client.currency,
          decimals,
          at: depAt,
          valeurStock: valo.totals.valeur,
          valeurNette,
          cumulAvant: cumulDepreciation,
        })
      : null;

  // ---------------------------------------------------- écritures du Socle
  const ecritureIds = [
    ...inventaireRows.map((i) => i.ecritureId),
    ...depreciationRows.map((d) => d.ecritureId),
  ].filter((id): id is string => !!id);

  const ecritures = useQuery({
    queryKey: ["stock-ecritures", item?.id, ecritureIds.join(",")],
    queryFn: () => office().office.ecrituresByIds(ecritureIds),
    enabled: ecritureIds.length > 0,
  });

  // -------------------------------------------------------------- mutations
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stock-items", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["stock-mouvements", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["stock-inventaires", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["stock-depreciations", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["stock-ecritures"] });
  };

  const saveItem = useMutation({
    mutationFn: async (input: ItemForm) => {
      if (!client || !pack.data) throw new Error("client.missing");
      if (input.id) {
        await office().stocks.updateItem({
          id: input.id,
          designation: input.designation,
          unite: input.unite,
          methode: input.methode,
          active: input.active,
        });
        return input.id;
      }
      const cat = (categories.data ?? []).find((c) => c.id === input.categoryId);
      if (!cat) throw new Error("category.missing");
      return office().stocks.createItem({
        tenantId: client.tenantId,
        entityId: null,
        categoryId: cat.id,
        reference: input.reference,
        designation: input.designation,
        unite: input.unite,
        methode: input.methode,
        // Les comptes viennent du pack, jamais d'une saisie libre.
        accountStock: cat.accountStock,
        accountVariation: cat.accountVariation,
        devise: client.currency,
        packVersionId: pack.data.id,
      });
    },
    onSuccess: (id) => {
      setForm(null);
      setError(null);
      setItemId(id);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const addMouvement = useMutation({
    mutationFn: async (input: MouvementForm) => {
      if (!client || !item) throw new Error("item.missing");
      return office().stocks.addMouvement({
        tenantId: client.tenantId,
        itemId: item.id,
        sens: input.sens,
        at: input.at,
        quantite: input.quantite,
        coutUnitaire: input.sens === "entree" ? input.coutUnitaire : null,
        reference: input.reference.trim() || null,
      });
    },
    onSuccess: () => {
      setMouvement(emptyMouvementForm());
      setError(null);
      invalidate();
    },
    onError: (e: Error) =>
      setError(e.message.includes("stocks_mouvements_uniq") ? t("cab.stocks.dup") : e.message),
  });

  const constaterInventaire = useMutation({
    mutationFn: async () => {
      if (!item || !pack.data || !variation) throw new Error("variation.missing");
      return office().stocks.constaterInventaire({
        itemId: item.id,
        period: variation.period,
        initial: variation.initial,
        final: variation.final,
        variation: variation.variation,
        packVersionId: pack.data.id,
        date: invDate,
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e: Error) =>
      setError(
        e.message.includes("deja constate") || e.message.includes("stocks_inventaires_uniq")
          ? t("cab.stocks.invdup")
          : e.message,
      ),
  });

  const constaterDepreciation = useMutation({
    mutationFn: async () => {
      if (!item || !pack.data || !depreciation) throw new Error("depreciation.missing");
      return office().stocks.constaterDepreciation({
        itemId: item.id,
        at: depreciation.at,
        valeurStock: depreciation.valeur_stock,
        valeurNette: depreciation.valeur_nette,
        mouvement: depreciation.mouvement,
        cumul: depreciation.cumul_apres,
        packVersionId: pack.data.id,
        note: depNote.trim() || null,
      });
    },
    onSuccess: () => {
      setValeurNette("");
      setDepNote("");
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.stocks.voice")}</RegalicaNote>, [locale]);

  useEffect(() => {
    setForm(null);
    setError(null);
  }, [client?.tenantId]);

  const categoryRows = categories.data ?? [];
  const packMethode = params.data?.stockMethode ?? "cump";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t("cab.stocks.title")}</h1>

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
                setItemId(null);
              }}
            />
            <ActionButton onClick={() => setForm(emptyItemForm(packMethode))}>
              {t("cab.stocks.new")}
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
                saveItem.mutate(form);
              }}
            >
              <SectionTitle>{form.id ? t("cab.stocks.edit") : t("cab.stocks.new")}</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.stocks.category")}</span>
                  <select
                    className={`${FIELD} w-full`}
                    value={form.categoryId}
                    disabled={!!form.id}
                    required={!form.id}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
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
                  <span className={LABEL}>{t("cab.stocks.reference")}</span>
                  <input
                    className={`${FIELD} num w-full`}
                    value={form.reference}
                    disabled={!!form.id}
                    required
                    onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.stocks.designation")}</span>
                  <input
                    className={`${FIELD} w-full`}
                    value={form.designation}
                    required
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.stocks.unite")}</span>
                  <input
                    className={`${FIELD} w-full`}
                    value={form.unite}
                    required
                    onChange={(e) => setForm({ ...form, unite: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.stocks.method")}</span>
                  <select
                    className={`${FIELD} w-full`}
                    value={form.methode}
                    onChange={(e) =>
                      setForm({ ...form, methode: e.target.value as ItemForm["methode"] })
                    }
                  >
                    <option value="cump">{t("cab.stocks.method.cump")}</option>
                    <option value="fifo">{t("cab.stocks.method.fifo")}</option>
                  </select>
                </label>
                {form.id ? (
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.active")}</span>
                    <select
                      className={`${FIELD} w-full`}
                      value={form.active ? "1" : "0"}
                      onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}
                    >
                      <option value="1">{t("cab.stocks.yes")}</option>
                      <option value="0">{t("cab.stocks.no")}</option>
                    </select>
                  </label>
                ) : null}
              </div>
              {form.categoryId ? (
                <p className="num text-[11px] text-muted-foreground">
                  {(() => {
                    const cat = categoryRows.find((c) => c.id === form.categoryId);
                    return cat
                      ? `${cat.accountStock} / ${cat.accountVariation} / ${cat.accountProvision} — ${cat.legalReference ?? ""}`
                      : "";
                  })()}
                </p>
              ) : null}
              <div className="flex gap-2">
                <ActionButton type="submit" disabled={saveItem.isPending}>
                  {t("cab.stocks.save")}
                </ActionButton>
                <ActionButton variant="stone" onClick={() => setForm(null)}>
                  {t("cab.stocks.cancel")}
                </ActionButton>
              </div>
            </form>
          ) : null}

          <SectionTitle>{t("cab.stocks.items")}</SectionTitle>
          {itemRows.length === 0 ? (
            <EmptyState>{t("cab.stocks.empty")}</EmptyState>
          ) : (
            <InkTable
              caption={t("cab.stocks.items")}
              head={[
                t("cab.stocks.reference"),
                t("cab.stocks.designation"),
                t("cab.stocks.unite"),
                t("cab.stocks.method"),
                "",
              ]}
            >
              {itemRows.map((i) => (
                <InkTableRow key={i.id}>
                  <InkCell numeric>{i.reference}</InkCell>
                  <InkCell>{i.designation}</InkCell>
                  <InkCell>{i.unite}</InkCell>
                  <InkCell>{t(`cab.stocks.method.${i.methode}`)}</InkCell>
                  <InkCell>
                    <span className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setItemId(i.id)}
                        className="text-[11px] uppercase tracking-wide underline"
                      >
                        {t("cab.stocks.open")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm(fromItem(i))}
                        className="text-[11px] uppercase tracking-wide underline"
                      >
                        {t("cab.stocks.edit")}
                      </button>
                    </span>
                  </InkCell>
                </InkTableRow>
              ))}
            </InkTable>
          )}

          {item ? (
            <>
              <section className="space-y-3">
                <SectionTitle>
                  {t("cab.stocks.mouvements")} — {item.designation}
                </SectionTitle>

                <form
                  className="grid gap-3 border border-border p-4 sm:grid-cols-2 lg:grid-cols-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addMouvement.mutate(mouvement);
                  }}
                >
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.sens")}</span>
                    <select
                      className={`${FIELD} w-full`}
                      value={mouvement.sens}
                      onChange={(e) =>
                        setMouvement({
                          ...mouvement,
                          sens: e.target.value as MouvementForm["sens"],
                        })
                      }
                    >
                      <option value="entree">{t("cab.stocks.sens.entree")}</option>
                      <option value="sortie">{t("cab.stocks.sens.sortie")}</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.date")}</span>
                    <input
                      type="date"
                      className={`${FIELD} num w-full`}
                      value={mouvement.at}
                      required
                      onChange={(e) => setMouvement({ ...mouvement, at: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.qty")}</span>
                    <input
                      inputMode="decimal"
                      className={`${FIELD} num w-full`}
                      value={mouvement.quantite}
                      required
                      onChange={(e) => setMouvement({ ...mouvement, quantite: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.cu")}</span>
                    <input
                      inputMode="decimal"
                      className={`${FIELD} num w-full`}
                      value={mouvement.coutUnitaire}
                      disabled={mouvement.sens === "sortie"}
                      required={mouvement.sens === "entree"}
                      onChange={(e) => setMouvement({ ...mouvement, coutUnitaire: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.ref")}</span>
                    <input
                      className={`${FIELD} num w-full`}
                      value={mouvement.reference}
                      onChange={(e) => setMouvement({ ...mouvement, reference: e.target.value })}
                    />
                  </label>
                  <div className="flex items-end">
                    <ActionButton type="submit" disabled={addMouvement.isPending}>
                      {t("cab.stocks.addmouv")}
                    </ActionButton>
                  </div>
                </form>

                {mouvements.isPending ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : !valo || valo.lignes.length === 0 ? (
                  <EmptyState>{t("cab.stocks.nomouv")}</EmptyState>
                ) : (
                  <>
                    <InkTable
                      caption={t("cab.stocks.mouvements")}
                      head={[
                        t("cab.stocks.date"),
                        t("cab.stocks.sens"),
                        t("cab.stocks.qty"),
                        t("cab.stocks.movement"),
                        t("cab.stocks.qtyafter"),
                        t("cab.stocks.valafter"),
                        t("cab.stocks.cump"),
                      ]}
                    >
                      {valo.lignes.map((l, index) => (
                        <InkTableRow key={`${l.at}-${index}`}>
                          <InkCell numeric>{l.at}</InkCell>
                          <InkCell>{t(`cab.stocks.sens.${l.sens}`)}</InkCell>
                          <InkCell numeric>{l.quantite}</InkCell>
                          <InkCell numeric>{l.valeur_mouvement}</InkCell>
                          <InkCell numeric>{l.quantite_apres}</InkCell>
                          <InkCell numeric>{l.valeur_apres}</InkCell>
                          <InkCell numeric>{l.cump}</InkCell>
                        </InkTableRow>
                      ))}
                    </InkTable>
                    <p className="num text-[11px] text-muted-foreground">
                      {t("cab.stocks.totals", {
                        quantite: valo.totals.quantite,
                        valeur: valo.totals.valeur,
                        currency: valo.currency,
                      })}
                    </p>
                  </>
                )}
              </section>

              {/* ------------------------------------------- variation d'inventaire */}
              <section className="space-y-3 border border-border p-4">
                <SectionTitle>{t("cab.stocks.inventaire")}</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.period")}</span>
                    <input
                      type="month"
                      className={`${FIELD} num w-full`}
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.invdate")}</span>
                    <input
                      type="date"
                      className={`${FIELD} num w-full`}
                      value={invDate}
                      onChange={(e) => setInvDate(e.target.value)}
                    />
                  </label>
                  <p className="num self-end text-[12px]">
                    {t("cab.stocks.initial")} : {variation?.initial ?? "—"}
                  </p>
                  <p className="num self-end text-[12px]">
                    {t("cab.stocks.final")} : {variation?.final ?? "—"}
                  </p>
                </div>
                <p className="num text-[13px]">
                  {t("cab.stocks.variation")} : {variation?.variation ?? "—"}{" "}
                  {variation?.currency ?? ""}
                </p>
                <ActionButton
                  disabled={
                    !variation ||
                    variation.variation.replace(/[-0.]/g, "") === "" ||
                    periodeDejaConstatee ||
                    constaterInventaire.isPending
                  }
                  onClick={() => constaterInventaire.mutate()}
                >
                  {periodeDejaConstatee ? t("cab.stocks.invdone") : t("cab.stocks.constater")}
                </ActionButton>

                {inventaireRows.length > 0 ? (
                  <InkTable
                    caption={t("cab.stocks.inventaire")}
                    head={[
                      t("cab.stocks.period"),
                      t("cab.stocks.initial"),
                      t("cab.stocks.final"),
                      t("cab.stocks.variation"),
                    ]}
                  >
                    {inventaireRows.map((i) => (
                      <InkTableRow key={i.id}>
                        <InkCell numeric>{i.period}</InkCell>
                        <InkCell numeric>{i.initial}</InkCell>
                        <InkCell numeric>{i.final}</InkCell>
                        <InkCell numeric>{i.variation}</InkCell>
                      </InkTableRow>
                    ))}
                  </InkTable>
                ) : null}
              </section>

              {/* -------------------------------------------------- dépréciation */}
              <section className="space-y-3 border border-border p-4">
                <SectionTitle>{t("cab.stocks.depreciation")}</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.date")}</span>
                    <input
                      type="date"
                      className={`${FIELD} num w-full`}
                      value={depAt}
                      onChange={(e) => setDepAt(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.vnr")}</span>
                    <input
                      inputMode="decimal"
                      className={`${FIELD} num w-full`}
                      value={valeurNette}
                      onChange={(e) => setValeurNette(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1 lg:col-span-2">
                    <span className={LABEL}>{t("cab.stocks.note")}</span>
                    <input
                      className={`${FIELD} w-full`}
                      value={depNote}
                      onChange={(e) => setDepNote(e.target.value)}
                    />
                  </label>
                </div>
                <p className="num text-[12px] text-muted-foreground">
                  {t("cab.stocks.cost")} : {valo?.totals.valeur ?? "—"} · {t("cab.stocks.cumul")} :{" "}
                  {cumulDepreciation}
                </p>
                {depreciation ? (
                  <p className="num text-[13px]">
                    {t("cab.stocks.movement")} : {depreciation.mouvement} ·{" "}
                    {t("cab.stocks.cumulafter")} : {depreciation.cumul_apres}
                  </p>
                ) : null}
                <ActionButton
                  disabled={
                    !depreciation ||
                    Number(depreciation.mouvement) === 0 ||
                    constaterDepreciation.isPending
                  }
                  onClick={() => constaterDepreciation.mutate()}
                >
                  {depreciation && Number(depreciation.mouvement) < 0
                    ? t("cab.stocks.reprise")
                    : t("cab.stocks.constater")}
                </ActionButton>

                {depreciationRows.length > 0 ? (
                  <InkTable
                    caption={t("cab.stocks.depreciation")}
                    head={[
                      t("cab.stocks.date"),
                      t("cab.stocks.cost"),
                      t("cab.stocks.vnr"),
                      t("cab.stocks.movement"),
                      t("cab.stocks.cumul"),
                      t("cab.stocks.note"),
                    ]}
                  >
                    {depreciationRows.map((d) => (
                      <InkTableRow key={d.id}>
                        <InkCell numeric>{d.at}</InkCell>
                        <InkCell numeric>{d.valeurStock}</InkCell>
                        <InkCell numeric>{d.valeurNette}</InkCell>
                        <InkCell numeric>{d.mouvement}</InkCell>
                        <InkCell numeric>{d.cumul}</InkCell>
                        <InkCell>{d.note ?? "—"}</InkCell>
                      </InkTableRow>
                    ))}
                  </InkTable>
                ) : null}
              </section>

              {/* ------------------------------------------- écritures produites */}
              {ecritureIds.length > 0 ? (
                <section className="space-y-3">
                  <SectionTitle>{t("cab.stocks.ecritures")}</SectionTitle>
                  {ecritures.isPending ? (
                    <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                  ) : (
                    (ecritures.data ?? []).map((e) => (
                      <div key={e.id} className="space-y-2 border border-border p-3">
                        <p className="num text-[12px]">
                          {e.dateEcriture} · {e.journal} · {e.libelle}
                        </p>
                        <InkTable
                          caption={e.libelle}
                          head={[
                            t("cab.stocks.account"),
                            t("cab.stocks.designation"),
                            t("cab.stocks.debit"),
                            t("cab.stocks.credit"),
                          ]}
                        >
                          {e.lines.map((l) => (
                            <InkTableRow key={`${e.id}-${l.ordinal}`}>
                              <InkCell numeric>{l.accountCode}</InkCell>
                              <InkCell>{l.libelle}</InkCell>
                              <InkCell numeric>{l.debit}</InkCell>
                              <InkCell numeric>{l.credit}</InkCell>
                            </InkTableRow>
                          ))}
                        </InkTable>
                      </div>
                    ))
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
