/**
 * Stocks et variation — la valorisation d'un article, mouvement par mouvement.
 *
 * ============================================================== POURQUOI
 *
 * L'écran du design : un kicker qui dit la méthode et le mois, la table des
 * mouvements valorisés, et à droite l'encart de variation d'inventaire qui se
 * constate d'un bouton. Tout chiffre vient du moteur de stock du Socle : la
 * méthode est celle du pack ou de l'article, les décimales celles du pack,
 * et l'écran ne fait que grouper les milliers dans la langue du lecteur.
 *
 * Les formulaires — article, mouvement, dépréciation — restent à portée,
 * derrière les boutons de l'en-tête ou dans des sections repliables : ils
 * n'écrasent plus la lecture.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { ClientPicker } from "@/components/malica/ClientPicker";
import { ecrireDossierCourant, useDossierCourant } from "@/components/malica/dossier-courant";
import {
  ActionButton,
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionRepliable,
  SectionTitle,
} from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant, montantSigne, quantite } from "@/lib/lisible";
import { estNul, sommeDecimale } from "@malica/socle/somme-decimale";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { StockItem } from "@malica/socle/ports/repositories";
import {
  computeStock,
  computeStockDepreciation,
  computeStockVariation,
} from "@malica/socle/engines/stock/valorisation";

export const Route = createFileRoute("/_authenticated/cabinet/stocks")({
  head: () => ({
    meta: [
      { title: "Stocks — Malica Office" },
      {
        name: "description",
        content:
          "Articles, mouvements, valorisation CUMP et FIFO et dépréciations calculées par le Socle.",
      },
      { property: "og:title", content: "Stocks — Malica Office" },
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

const OU = "routes/_authenticated/cabinet.stocks";
/** Une chaîne décimale telle que le Socle l'accepte — la virgule du clavier français est admise. */
const DECIMAL = /^-?\d+(\.\d+)?$/;
const FIELD = "border border-border bg-card px-2.5 py-1.5 text-[12.5px] outline-none";
const LABEL = "block text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground";
const KICKER = "text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground";

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
  const dossierCourant = useDossierCourant();
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemForm | null>(null);
  const [mouvement, setMouvement] = useState<MouvementForm>(emptyMouvementForm);
  const [error, setError] = useState<string | null>(null);
  const [mouvOuvert, setMouvOuvert] = useState(false);
  const [articlesOuvert, setArticlesOuvert] = useState(false);
  const [depOuvert, setDepOuvert] = useState(false);
  const [ecrituresOuvert, setEcrituresOuvert] = useState(false);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const rows = clients.data ?? [];
  const client =
    rows.find((c) => c.tenantId === tenantId) ??
    // Sans choix ici, l'onglet s'ouvre sur le dossier courant du cabinet.
    rows.find((c) => c.tenantId === dossierCourant?.id) ??
    rows[0] ??
    null;

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

  const inventaireRows = inventaires.data ?? [];
  const depreciationRows = depreciations.data ?? [];

  // La valorisation vient du Socle ; la méthode est celle du pack ou de l'article,
  // les décimales celles du pack — sans repli : sans pack, rien ne se calcule (R4).
  // Un mouvement que le moteur refuse ne se montre pas en clair : sa raison part
  // au journal de l'atelier, l'écran dit une phrase lisible.
  const lecture = useMemo(() => {
    if (!item || !params.data || !client || !mouvements.data) return null;
    const decimals = params.data.moneyDecimals;
    try {
      const valo = computeStock(
        {
          currency: item.devise || client.currency,
          decimals,
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
      return { valo, decimals, erreur: null };
    } catch (e) {
      return {
        valo: null,
        decimals,
        erreur: texteDeLErreur(e, OU, t("cab.stocks.valo.illisible")),
      };
    }
  }, [item, params.data, client, mouvements.data, t]);
  const valo = lecture?.valo ?? null;

  // ------------------------------------------------------- variation d'inventaire
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Le stock initial de la période est le final de la dernière période constatée
  // AVANT elle — pas de la dernière constatée tout court, qui peut lui être
  // postérieure si l'expert revient sur un mois ancien.
  const inventairePrecedent = inventaireRows.filter((i) => i.period < period).at(-1) ?? null;
  const stockInitial = inventairePrecedent?.final ?? "0";

  // Le stock final de la période : la valeur après le dernier mouvement qui la
  // précède ou lui appartient. Les lignes du moteur sont chronologiques.
  const stockFinal = valo
    ? (valo.lignes.filter((l) => l.at.slice(0, 7) <= period).at(-1)?.valeur_apres ?? "0")
    : null;

  const variation =
    lecture && client && stockFinal !== null
      ? computeStockVariation({
          currency: item?.devise || client.currency,
          decimals: lecture.decimals,
          period,
          initial: stockInitial,
          final: stockFinal,
        })
      : null;

  const periodeDejaConstatee = inventaireRows.some((i) => i.period === period);
  const inventaireConstatable =
    !!lecture && !!variation && !estNul(variation.variation, lecture.decimals);

  // Les entrées et sorties du mois : la somme exacte des lignes du moteur, en entiers.
  const duMois = useMemo(() => {
    if (!lecture?.valo) return null;
    const lignes = lecture.valo.lignes.filter((l) => l.at.slice(0, 7) === period);
    const somme = (sens: "entree" | "sortie") =>
      sommeDecimale(
        lignes.filter((l) => l.sens === sens).map((l) => l.valeur_mouvement),
        lecture.decimals,
      );
    return { entrees: somme("entree"), sorties: somme("sortie") };
  }, [lecture, period]);

  // ------------------------------------------------------------- dépréciation
  const [depAt, setDepAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [valeurNette, setValeurNette] = useState("");
  const [depNote, setDepNote] = useState("");

  const cumulDepreciation =
    depreciationRows.length > 0 ? depreciationRows[depreciationRows.length - 1]!.cumul : "0";

  // Le coût du stock à la date de la dépréciation, pas à la fin de tous les mouvements.
  const coutAuJour = valo
    ? (valo.lignes.filter((l) => l.at.slice(0, 10) <= depAt).at(-1)?.valeur_apres ?? "0")
    : null;

  // La saisie ne part au moteur que lorsqu'elle est un nombre : « abc » n'est
  // pas une valeur nette, et le moteur le refuserait en pleine lecture.
  const valeurNetteSaisie = valeurNette.trim().replace(",", ".");
  const depreciation =
    lecture && client && coutAuJour !== null && DECIMAL.test(valeurNetteSaisie)
      ? computeStockDepreciation({
          currency: item?.devise || client.currency,
          decimals: lecture.decimals,
          at: depAt,
          valeurStock: coutAuJour,
          valeurNette: valeurNetteSaisie,
          cumulAvant: cumulDepreciation,
        })
      : null;
  const depreciationConstatable =
    !!lecture && !!depreciation && !estNul(depreciation.mouvement, lecture.decimals);

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
    onError: (e: unknown) => setError(texteDeLErreur(e, OU, t("common.error"))),
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
    onError: (e: unknown) =>
      setError(
        e instanceof Error && e.message.includes("stocks_mouvements_uniq")
          ? t("cab.stocks.dup")
          : texteDeLErreur(e, OU, t("common.error")),
      ),
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
    onError: (e: unknown) =>
      setError(
        e instanceof Error &&
          (e.message.includes("deja constate") || e.message.includes("stocks_inventaires_uniq"))
          ? t("cab.stocks.invdup")
          : texteDeLErreur(e, OU, t("common.error")),
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
    onError: (e: unknown) => setError(texteDeLErreur(e, OU, t("common.error"))),
  });

  useMalicaPanel(<MalicaNote>{t("cab.stocks.voice")}</MalicaNote>, [locale]);

  useEffect(() => {
    setForm(null);
    setError(null);
  }, [client?.tenantId]);

  const categoryRows = categories.data ?? [];
  const devise = valo?.currency ?? item?.devise ?? client?.currency ?? "";

  // ---------------------------------------------------------------- lecture
  const dateLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const moisLong = (mois: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${mois}-01T00:00:00Z`),
    );
  const signe = (valeur: string) =>
    Number(valeur) > 0 ? "text-signal-ok" : Number(valeur) < 0 ? "text-signal-stop" : "";

  // La méthode se lit dans le résultat du moteur, à défaut sur l'article, à défaut au pack.
  const methode = valo?.methode ?? item?.methode ?? params.data?.stockMethode ?? null;
  const kicker = methode
    ? t("cab.stocks.kicker", { methode: t(`cab.stocks.method.${methode}`), mois: moisLong(period) })
    : moisLong(period);

  const categorie = form ? categoryRows.find((c) => c.id === form.categoryId) : undefined;

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-foreground pb-6">
        <div className="min-w-0">
          <p className="num text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {kicker}
          </p>
          <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
            {t("cab.stocks.title")}
          </h1>
          {item ? (
            <p className="mt-3 text-[13.5px] leading-[1.55] text-text-2">
              <span className="num">{item.reference}</span> · {item.designation} · {item.unite}
            </p>
          ) : null}
        </div>
        {rows.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <ClientPicker
              label={t("cab.queue.client")}
              clients={rows}
              value={client?.tenantId ?? null}
              onChange={(id) => {
                setTenantId(id);
                const choisi = rows.find((c) => c.tenantId === id);
                if (choisi) ecrireDossierCourant({ id: choisi.tenantId, name: choisi.name });
                setItemId(null);
              }}
            />
            {itemRows.length > 0 ? (
              <label className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
                <span className="text-muted-foreground">{t("cab.stocks.article")}</span>
                <select
                  value={item?.id ?? ""}
                  onChange={(e) => setItemId(e.target.value)}
                  className="max-w-[260px] border border-border bg-card px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
                >
                  {itemRows.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.reference} · {i.designation}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {/* La méthode proposée au nouvel article est celle du pack : sans pack lu, pas de proposition. */}
            {params.data ? (
              <ActionButton onClick={() => setForm(emptyItemForm(params.data.stockMethode))}>
                {t("cab.stocks.new")}
              </ActionButton>
            ) : null}
            {item ? (
              <ActionButton
                variant={mouvOuvert ? "ink" : "stone"}
                onClick={() => setMouvOuvert((o) => !o)}
              >
                {t("cab.stocks.mouvement.nouveau")}
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </header>

      {[lecture?.erreur, error]
        .filter((m): m is string => !!m)
        .map((m) => (
          <p
            key={m}
            className="border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12.5px]"
          >
            {m}
          </p>
        ))}

      {/* ---- l'article, à créer ou à corriger */}
      {form ? (
        <form
          className="space-y-4 border border-border bg-card p-4"
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
          {categorie ? (
            <p className="text-[11px] text-muted-foreground">
              <span className="num">
                {t("cab.stocks.comptes", {
                  stock: categorie.accountStock,
                  variation: categorie.accountVariation,
                  provision: categorie.accountProvision,
                })}
              </span>
              {categorie.legalReference ? (
                <span className="mt-0.5 block text-signal-info">{categorie.legalReference}</span>
              ) : null}
            </p>
          ) : null}
          <div className="flex gap-2">
            <ActionButton variant="ink" type="submit" disabled={saveItem.isPending}>
              {t("cab.stocks.save")}
            </ActionButton>
            <ActionButton onClick={() => setForm(null)}>{t("cab.stocks.cancel")}</ActionButton>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState>{t("cab.clients.empty")}</EmptyState>
      ) : pack.data === null ? (
        // Sans pack en vigueur, ni décimales ni méthode : on le dit, on ne devine pas (R4).
        <EmptyState>{t("pack.none")}</EmptyState>
      ) : items.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !item ? (
        <EmptyState>{t("cab.stocks.empty")}</EmptyState>
      ) : (
        <>
          {/* ---- le mouvement, derrière le bouton de l'en-tête */}
          {mouvOuvert ? (
            <form
              className="grid gap-3 border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6"
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
                    setMouvement({ ...mouvement, sens: e.target.value as MouvementForm["sens"] })
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
                <ActionButton variant="ink" type="submit" disabled={addMouvement.isPending}>
                  {t("cab.stocks.addmouv")}
                </ActionButton>
              </div>
            </form>
          ) : null}

          <div className="grid gap-8 xl:grid-cols-[1.7fr_1fr]">
            {/* ---- les mouvements valorisés */}
            <section className="min-w-0 space-y-3">
              <SectionTitle
                action={
                  valo && valo.lignes.length > 0 ? (
                    <span className="num text-[10.5px] text-muted-foreground">
                      {t("cab.stocks.totals", {
                        quantite: quantite(valo.totals.quantite, locale),
                        valeur: montant(valo.totals.valeur, locale),
                        currency: valo.currency,
                      })}
                    </span>
                  ) : null
                }
              >
                {t("cab.stocks.mouvements.titre")}
              </SectionTitle>

              {mouvements.isPending || params.isPending ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : !valo || valo.lignes.length === 0 ? (
                <EmptyState>{t("cab.stocks.nomouv")}</EmptyState>
              ) : (
                <div className="overflow-x-auto border border-border bg-card">
                  <table className="min-w-full border-collapse text-[12.5px]">
                    <caption className="sr-only">{t("cab.stocks.mouvements.titre")}</caption>
                    <thead>
                      <tr className="border-b border-foreground">
                        {[
                          [t("cab.stocks.date"), false],
                          [t("cab.stocks.sens"), false],
                          [t("cab.stocks.qty"), true],
                          [t("cab.stocks.col.valeur", { devise }), true],
                          [t("cab.stocks.qtyafter"), true],
                          // Le coût unitaire après mouvement — moyen en CUMP, du
                          // dernier lot en FIFO : la colonne ne nomme pas une méthode.
                          [t("cab.stocks.cu.apres"), true],
                        ].map(([h, fin]) => (
                          <th
                            key={String(h)}
                            scope="col"
                            className={cn(
                              "whitespace-nowrap px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                              fin ? "text-end" : "text-start",
                            )}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {valo.lignes.map((l, index) => (
                        <tr
                          key={`${l.at}-${index}`}
                          className="border-b border-border last:border-b-0 hover:bg-secondary/60"
                        >
                          <td className="num whitespace-nowrap px-3 py-2 text-[11.5px]">
                            {dateLisible(l.at)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className="inline-flex items-center gap-2">
                              <span
                                aria-hidden
                                className={cn(
                                  "inline-block h-[7px] w-[7px]",
                                  l.sens === "entree" ? "bg-foreground" : "bg-muted-foreground",
                                )}
                              />
                              {t(`cab.stocks.sens.${l.sens}`)}
                            </span>
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-end font-medium">
                            {l.sens === "sortie"
                              ? `−${quantite(l.quantite, locale)}`
                              : quantite(l.quantite, locale)}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-end font-medium">
                            {montant(l.valeur_mouvement, locale)}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-end font-medium">
                            {quantite(l.quantite_apres, locale)}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-end font-medium">
                            {montant(l.cump, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ---- la variation d'inventaire */}
            <aside className="min-w-0 space-y-4">
              <div className="border border-border bg-card p-4">
                <p className={KICKER}>{t("cab.stocks.inventaire")}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.period")}</span>
                    <input
                      type="month"
                      className={`${FIELD} num w-full`}
                      value={period}
                      onChange={(e) => e.target.value && setPeriod(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>{t("cab.stocks.invdate")}</span>
                    <input
                      type="date"
                      className={`${FIELD} num w-full`}
                      value={invDate}
                      onChange={(e) => e.target.value && setInvDate(e.target.value)}
                    />
                  </label>
                </div>
                <ul className="mt-4 space-y-3">
                  {[
                    {
                      key: "initial",
                      label: t("cab.stocks.initial"),
                      detail: inventairePrecedent ? moisLong(inventairePrecedent.period) : null,
                      value: variation ? montant(variation.initial, locale) : "—",
                      fort: false,
                      tone: "",
                    },
                    {
                      key: "entrees",
                      label: t("cab.stocks.var.entrees"),
                      detail: null,
                      value: duMois ? montantSigne(duMois.entrees, locale) : "—",
                      fort: false,
                      tone: "",
                    },
                    {
                      key: "sorties",
                      label: t("cab.stocks.var.sorties"),
                      detail: null,
                      value: duMois ? montant(duMois.sorties, locale) : "—",
                      fort: false,
                      tone: "",
                    },
                    {
                      key: "final",
                      label: t("cab.stocks.final"),
                      detail: null,
                      value: variation ? montant(variation.final, locale) : "—",
                      fort: true,
                      tone: "",
                    },
                    {
                      key: "variation",
                      label: t("cab.stocks.variation"),
                      detail: null,
                      value: variation ? montantSigne(variation.variation, locale) : "—",
                      fort: true,
                      tone: variation ? signe(variation.variation) : "",
                    },
                  ].map((v) => (
                    <li
                      key={v.key}
                      className={cn(
                        "flex items-baseline justify-between gap-3 border-t border-border pt-3",
                        v.fort ? "font-semibold" : "text-text-2",
                        v.tone,
                      )}
                    >
                      <span className="text-[12.5px]">
                        {v.label}
                        {v.detail ? (
                          <span className="num ms-1.5 text-[10.5px] font-normal text-muted-foreground">
                            {v.detail}
                          </span>
                        ) : null}
                      </span>
                      <span className="num whitespace-nowrap text-[13px]">{v.value}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={
                    !inventaireConstatable || periodeDejaConstatee || constaterInventaire.isPending
                  }
                  onClick={() => constaterInventaire.mutate()}
                  className="mt-5 w-full border border-foreground bg-foreground px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-background transition-colors hover:border-marigold hover:bg-marigold hover:text-foreground disabled:opacity-40 disabled:hover:border-foreground disabled:hover:bg-foreground disabled:hover:text-background"
                >
                  {periodeDejaConstatee
                    ? t("cab.stocks.invdone")
                    : t("cab.stocks.constater.periode")}
                </button>
              </div>

              {inventaireRows.length > 0 ? (
                <div className="border border-border bg-card p-4">
                  <p className={KICKER}>{t("cab.stocks.historique")}</p>
                  <ul className="mt-3 divide-y divide-border">
                    {inventaireRows.map((i) => (
                      <li
                        key={i.id}
                        className="flex items-baseline justify-between gap-3 py-2 text-[12.5px]"
                      >
                        <span className="num">{moisLong(i.period)}</span>
                        <span className="num text-end">
                          <span className={cn("block", signe(i.variation))}>
                            {montantSigne(i.variation, locale)}
                          </span>
                          <span className="block text-[10.5px] text-muted-foreground">
                            {montant(i.initial, locale)} → {montant(i.final, locale)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </aside>
          </div>

          {/* ---- les articles du client */}
          <SectionRepliable
            titre={t("cab.stocks.items")}
            ouvert={articlesOuvert}
            onBascule={() => setArticlesOuvert((o) => !o)}
            resume={t("cab.stocks.articles.count", { count: itemRows.length })}
          >
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
                  <InkCell numeric className={i.id === item.id ? "font-semibold" : ""}>
                    {i.reference}
                  </InkCell>
                  <InkCell className={i.id === item.id ? "font-semibold" : ""}>
                    {i.designation}
                  </InkCell>
                  <InkCell>{i.unite}</InkCell>
                  <InkCell>{t(`cab.stocks.method.${i.methode}`)}</InkCell>
                  <InkCell>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setItemId(i.id)}
                        className="border border-border px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
                      >
                        {t("cab.stocks.open")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm(fromItem(i))}
                        className="border border-border px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
                      >
                        {t("cab.stocks.edit")}
                      </button>
                    </span>
                  </InkCell>
                </InkTableRow>
              ))}
            </InkTable>
          </SectionRepliable>

          {/* ---- la dépréciation */}
          <SectionRepliable
            titre={t("cab.stocks.depreciation")}
            ouvert={depOuvert}
            onBascule={() => setDepOuvert((o) => !o)}
            resume={
              <span className="num">
                {t("cab.stocks.cumul")} : {montant(cumulDepreciation, locale)}
              </span>
            }
          >
            <div className="space-y-4 border border-border bg-card p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1">
                  <span className={LABEL}>{t("cab.stocks.date")}</span>
                  <input
                    type="date"
                    className={`${FIELD} num w-full`}
                    value={depAt}
                    onChange={(e) => e.target.value && setDepAt(e.target.value)}
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
              <ul className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
                <li className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-text-2">
                  <span>{t("cab.stocks.cost")}</span>
                  <span className="num">
                    {coutAuJour !== null ? montant(coutAuJour, locale) : "—"}
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-text-2">
                  <span>{t("cab.stocks.cumul")}</span>
                  <span className="num">{montant(cumulDepreciation, locale)}</span>
                </li>
                <li
                  className={cn(
                    "flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold",
                    depreciation ? signe(depreciation.mouvement) : "",
                  )}
                >
                  <span>{t("cab.stocks.movement")}</span>
                  <span className="num">
                    {depreciation ? montantSigne(depreciation.mouvement, locale) : "—"}
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold">
                  <span>{t("cab.stocks.cumulafter")}</span>
                  <span className="num">
                    {depreciation ? montant(depreciation.cumul_apres, locale) : "—"}
                  </span>
                </li>
              </ul>
              <ActionButton
                variant="ink"
                disabled={!depreciationConstatable || constaterDepreciation.isPending}
                onClick={() => constaterDepreciation.mutate()}
              >
                {depreciation && Number(depreciation.mouvement) < 0
                  ? t("cab.stocks.reprise")
                  : t("cab.stocks.constater")}
              </ActionButton>
            </div>

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
                    <InkCell numeric>{dateLisible(d.at)}</InkCell>
                    <InkCell numeric>{montant(d.valeurStock, locale)}</InkCell>
                    <InkCell numeric>{montant(d.valeurNette, locale)}</InkCell>
                    <InkCell numeric className={signe(d.mouvement)}>
                      {montantSigne(d.mouvement, locale)}
                    </InkCell>
                    <InkCell numeric>{montant(d.cumul, locale)}</InkCell>
                    <InkCell>{d.note ?? "—"}</InkCell>
                  </InkTableRow>
                ))}
              </InkTable>
            ) : null}
          </SectionRepliable>

          {/* ---- les écritures produites */}
          {ecritureIds.length > 0 ? (
            <SectionRepliable
              titre={t("cab.stocks.ecritures")}
              ouvert={ecrituresOuvert}
              onBascule={() => setEcrituresOuvert((o) => !o)}
              resume={t("cab.stocks.ecritures.count", { count: ecritureIds.length })}
            >
              {ecritures.isPending ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : (
                (ecritures.data ?? []).map((e) => (
                  <div key={e.id} className="space-y-2 border border-border bg-card p-3">
                    <p className="text-[12px]">
                      <span className="num">{dateLisible(e.dateEcriture)}</span>
                      <span className="num ms-2 bg-foreground px-1 text-[9px] text-background">
                        {e.journal}
                      </span>
                      <span className="ms-2">{e.libelle}</span>
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
                          <InkCell numeric>{montant(l.debit, locale)}</InkCell>
                          <InkCell numeric>{montant(l.credit, locale)}</InkCell>
                        </InkTableRow>
                      ))}
                    </InkTable>
                  </div>
                ))
              )}
            </SectionRepliable>
          ) : null}
        </>
      )}
    </div>
  );
}
