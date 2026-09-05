/**
 * Immobilisations et amortissements — le registre du cabinet.
 *
 * ============================================================== POURQUOI
 *
 * Un écran, un exercice : chaque bien y lit sa dotation de l'année, sa valeur
 * nette et ce qui reste à constater. La méthode et la durée viennent de la
 * catégorie du pack, jamais d'une saisie libre ; le plan sort du Socle, et
 * l'écran ne calcule rien — il additionne des chaînes exactes pour les quatre
 * chiffres du bandeau, et c'est tout.
 *
 * Constater une dotation ferme la base : le bien ne se modifie plus. La fiche
 * du bien — plan complet, cession, dépréciation, écritures — s'ouvre depuis la
 * ligne du tableau : rien de ce que le moteur sait faire n'est perdu.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { ClientPicker } from "@/components/regalica/ClientPicker";
import { ecrireDossierCourant, useDossierCourant } from "@/components/regalica/dossier-courant";
import {
  ActionButton,
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionRepliable,
  SectionTitle,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { estNul, sommeDecimale } from "@/lib/somme-decimale";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type { Asset } from "@/verticals/regalica-office/ports/repositories";
import type {
  AmortissementLigne,
  AmortissementV1,
} from "@/verticals/regalica-office/socle/contracts/amortissement.v1";
import {
  computeAmortissement,
  computeCession,
  computeDepreciation,
  cumulAt,
  vncNette,
} from "@/verticals/regalica-office/socle/engines/immo/amortissement";

export const Route = createFileRoute("/_authenticated/cabinet/immobilisations")({
  head: () => ({
    meta: [
      { title: "Immobilisations — Regalica Office" },
      {
        name: "description",
        content:
          "Fiches d'immobilisation, dotations d'amortissement et dépréciations calculées par le Socle.",
      },
      { property: "og:title", content: "Immobilisations — Regalica Office" },
      {
        property: "og:description",
        content:
          "Fiches d'immobilisation, dotations d'amortissement et dépréciations calculées par le Socle.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetImmobilisations,
});

const FIELD = "border border-border bg-background px-2 py-1 text-[13px] outline-none";
const LABEL = "block text-[10px] uppercase tracking-wide text-muted-foreground";
const TH = "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";

type Volet = "plan" | "cession" | "dep" | "ecritures";

/** Méthode, durée et coefficient : lus à la catégorie du pack, jamais saisis. */
interface ReglesDuPack {
  method: "lineaire" | "degressif";
  dureeAnnees: number;
  coefficient: string;
}

interface AssetForm {
  id: string | null;
  categoryId: string;
  label: string;
  miseEnService: string;
  valeurBrute: string;
  valeurResiduelle: string;
  /** Rien tant qu'aucune catégorie n'est choisie : l'écran n'invente pas de durée. */
  regles: ReglesDuPack | null;
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
    regles: null,
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
    regles: { method: a.method, dureeAnnees: a.dureeAnnees, coefficient: a.coefficient },
    status: a.status,
  };
}

/**
 * La valeur nette comptable amortie à une date : la valeur brute diminuée du
 * cumul des dotations à cette date. Les deux nombres sortent du plan du Socle,
 * et la soustraction est celle du Socle (`vncNette`) — rien n'est calculé ici.
 */
function vncAmortieAu(plan: AmortissementV1, at: string, decimals: number): string {
  return vncNette({
    decimals,
    vncAmortie: plan.valeur_brute,
    cumulDepreciation: cumulAt(plan, at),
  });
}

/**
 * Ce que le plan dit d'un bien pour un exercice donné.
 *
 * Trois cas, et l'écran les distingue : l'exercice est dans le plan (une
 * ligne, une dotation) ; il est après la fin du plan (le bien est amorti,
 * cumul et VNC sont ceux de la dernière ligne) ; il est avant la mise en
 * service (rien : le bien n'existe pas encore pour cet exercice).
 */
function situation(
  plan: AmortissementV1,
  exercice: number,
): { ligne: AmortissementLigne | null; cumul: string; vnc: string } | null {
  const ligne = plan.lignes.find((l) => l.exercice === exercice);
  if (ligne) return { ligne, cumul: ligne.cumul, vnc: ligne.vnc };
  const premiere = plan.lignes[0];
  const derniere = plan.lignes[plan.lignes.length - 1];
  if (!premiere || !derniere || exercice < premiere.exercice) return null;
  return { ligne: null, cumul: derniere.cumul, vnc: derniere.vnc };
}

function CabinetImmobilisations() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const dossierCourant = useDossierCourant();
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [form, setForm] = useState<AssetForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exerciceChoisi, setExerciceChoisi] = useState<number | null>(null);
  const [volets, setVolets] = useState<Record<Volet, boolean>>({
    plan: true,
    cession: false,
    dep: false,
    ecritures: false,
  });
  const basculer = (v: Volet) => setVolets((s) => ({ ...s, [v]: !s[v] }));

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
  const cessions = useQuery({
    queryKey: ["immo-cessions", client?.tenantId],
    queryFn: () => office().immo.cessions(client!.tenantId),
    enabled: !!client,
  });

  const assetRows = useMemo(() => assets.data ?? [], [assets.data]);
  const asset = assetRows.find((a) => a.id === assetId) ?? null;
  // Les décimales viennent du pack, sans repli : tant qu'elles ne sont pas
  // lues, aucun total n'est rendu (R4).
  const decimals = params.data?.moneyDecimals;
  const categoryRows = categories.data ?? [];

  // Les plans sortent du Socle : durée, coefficient et décimales viennent du pack.
  const plans = useMemo(() => {
    const m = new Map<string, AmortissementV1>();
    if (!params.data || !client) return m;
    for (const a of assetRows) {
      try {
        m.set(
          a.id,
          computeAmortissement({
            currency: client.currency,
            decimals: params.data.moneyDecimals,
            method: a.method,
            dureeAnnees: a.dureeAnnees,
            coefficient: a.coefficient,
            valeurBrute: a.valeurBrute,
            valeurResiduelle: a.valeurResiduelle,
            miseEnService: a.miseEnService,
          }),
        );
      } catch {
        // Paramètres illisibles : la ligne le dit, l'écran ne devine pas.
      }
    }
    return m;
  }, [assetRows, params.data, client]);
  const plan = asset ? (plans.get(asset.id) ?? null) : null;

  // L'exercice lu : l'année en cours, ou l'une de celles que les plans touchent.
  const anneeCourante = new Date().getUTCFullYear();
  const exercices = useMemo(() => {
    const s = new Set<number>([anneeCourante]);
    for (const p of plans.values()) for (const l of p.lignes) s.add(l.exercice);
    return [...s].sort((a, b) => a - b);
  }, [plans, anneeCourante]);
  const exercice =
    exerciceChoisi !== null && exercices.includes(exerciceChoisi) ? exerciceChoisi : anneeCourante;

  const constatees = useMemo(
    () => new Set((dotations.data ?? []).map((d) => `${d.assetId}:${d.exercice}`)),
    [dotations.data],
  );

  // Les lignes du registre pour l'exercice lu.
  const registre = assetRows.map((a) => {
    const p = plans.get(a.id) ?? null;
    return {
      a,
      plan: p,
      s: p ? situation(p, exercice) : null,
      constatee: constatees.has(`${a.id}:${exercice}`),
    };
  });
  const enService = registre.filter((r) => r.a.status === "en_service");
  const situations = enService.flatMap((r) => (r.s ? [r.s] : []));
  const dotationsExercice = situations.flatMap((s) => (s.ligne ? [s.ligne.dotation] : []));
  const restantes = enService.filter((r) => r.s?.ligne && !r.constatee).length;
  // L'addition exacte de chaînes du Socle — ou rien tant que les décimales
  // du pack ou les biens ne sont pas lus.
  const total = (valeurs: string[]) =>
    decimals !== undefined && !assets.isPending ? sommeDecimale(valeurs, decimals) : null;
  const kpis = [
    {
      key: "vb",
      label: t("cab.immo.vb"),
      value: total(enService.map((r) => r.a.valeurBrute)),
      context: t("cab.immo.kpi.vb.ctx", { count: enService.length }),
    },
    {
      key: "dotations",
      label: t("cab.immo.kpi.dotations", { annee: exercice }),
      value: total(dotationsExercice),
      context:
        dotationsExercice.length === 0
          ? t("cab.immo.kpi.dotations.aucune")
          : restantes === 0
            ? t("cab.immo.kpi.dotations.toutes")
            : t("cab.immo.kpi.dotations.restent", { count: restantes }),
    },
    {
      key: "cumul",
      label: t("cab.immo.kpi.cumul"),
      value: total(situations.map((s) => s.cumul)),
      context: t("cab.immo.kpi.cloture", { annee: exercice }),
    },
    {
      key: "vnc",
      label: t("cab.immo.vnc"),
      value: total(situations.map((s) => s.vnc)),
      context: t("cab.immo.kpi.vnc.ctx"),
    },
  ];

  const assetDotations = (dotations.data ?? []).filter((d) => d.assetId === asset?.id);
  const assetDepreciations = (depreciations.data ?? []).filter((d) => d.assetId === asset?.id);
  const assetCessions = (cessions.data ?? []).filter((c) => c.assetId === asset?.id);
  const cumulDepreciation =
    assetDepreciations.length > 0 ? assetDepreciations[assetDepreciations.length - 1]!.cumul : "0";

  // ------------------------------------------------------------ dépréciation
  const [depAt, setDepAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [recouvrable, setRecouvrable] = useState("");
  const [depNote, setDepNote] = useState("");

  // VNC à la date de dépréciation, nette des dépréciations déjà constatées.
  const vncNetteValue =
    plan && decimals !== undefined
      ? vncNette({
          decimals,
          vncAmortie: vncAmortieAu(plan, depAt, decimals),
          cumulDepreciation,
        })
      : null;

  const depreciation =
    plan && client && decimals !== undefined && vncNetteValue !== null && recouvrable.trim() !== ""
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
    qc.invalidateQueries({ queryKey: ["immo-cessions", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["immo-assets", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["immo-dotations", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["immo-depreciations", client?.tenantId] });
    qc.invalidateQueries({ queryKey: ["immo-ecritures"] });
  };

  /*
   * ============================================== CÉDER UNE IMMOBILISATION
   *
   * L'écran ne calcule RIEN (R2). La valeur nette comptable à la date de
   * cession et le résultat sortent du Socle — `vncNette` puis `computeCession` —
   * exactement comme la dépréciation juste au-dessus. La saisie se limite à
   * la date et au prix ; le reste est lu, jamais tapé.
   */
  const [cessAt, setCessAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [cessPrix, setCessPrix] = useState("");

  const vncACession =
    plan && decimals !== undefined
      ? vncNette({
          decimals,
          vncAmortie: vncAmortieAu(plan, cessAt, decimals),
          cumulDepreciation,
        })
      : null;

  const cession =
    plan && client && decimals !== undefined && vncACession !== null && cessPrix.trim() !== ""
      ? computeCession({
          currency: client.currency,
          decimals,
          at: cessAt,
          prix: cessPrix.trim(),
          vnc: vncACession,
        })
      : null;

  const recordCession = useMutation({
    mutationFn: async () => {
      if (!asset || !client || !cession) throw new Error("cession.missing");
      const id = await office().immo.recordCession({
        tenantId: client.tenantId,
        assetId: asset.id,
        at: cession.at,
        prix: cession.prix,
        vnc: cession.vnc,
        resultat: cession.resultat,
      });
      // Aucun déclencheur ne bascule l'actif : la base enregistre la cession,
      // l'écran constate l'état qui en découle. Une cession sans ce passage
      // laisserait un bien vendu figurer parmi les actifs en service.
      await office().immo.updateAsset({
        id: asset.id,
        label: asset.label,
        miseEnService: asset.miseEnService,
        valeurBrute: asset.valeurBrute,
        valeurResiduelle: asset.valeurResiduelle,
        method: asset.method,
        dureeAnnees: asset.dureeAnnees,
        coefficient: asset.coefficient,
        status: "cede",
      });
      return id;
    },
    onSuccess: () => {
      setCessPrix("");
      setError(null);
      invalidate();
    },
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.immobilisations", t("common.error")),
      ),
  });

  const saveAsset = useMutation({
    mutationFn: async (input: AssetForm) => {
      // Le bouton est inactif dans ces cas ; ceci ne sert qu'à ne jamais écrire sans règles.
      if (!client || !pack.data || !input.regles) throw new Error("client.missing");
      if (input.id) {
        await office().immo.updateAsset({
          id: input.id,
          label: input.label,
          miseEnService: input.miseEnService,
          valeurBrute: input.valeurBrute,
          valeurResiduelle: input.valeurResiduelle,
          ...input.regles,
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
        ...input.regles,
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
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.immobilisations", t("common.error")),
      ),
  });

  const record = useMutation({
    mutationFn: async (input: { assetId: string; exercice: number }) => {
      const ligne = plans.get(input.assetId)?.lignes.find((l) => l.exercice === input.exercice);
      if (!ligne || !pack.data) throw new Error("plan.missing");
      return office().immo.constaterDotation({
        assetId: input.assetId,
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
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.immobilisations", t("common.error")),
      ),
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
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.immobilisations", t("common.error")),
      ),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.immo.voice")}</RegalicaNote>, [locale]);

  useEffect(() => {
    setForm(null);
    setError(null);
  }, [client?.tenantId]);

  const canEdit = assetDotations.length === 0;
  const dateLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const methodeDuree = (a: Pick<Asset, "method" | "dureeAnnees">) =>
    `${t(`cab.immo.method.${a.method}`)} · ${t("cab.immo.duree.ans", { count: a.dureeAnnees })}`;
  const categorieDe = (a: Asset) => categoryRows.find((c) => c.id === a.categoryId)?.label ?? null;

  const kicker = pack.data
    ? t("cab.immo.kicker", {
        annee: exercice,
        pack: `${client?.jurisdiction ?? org.jurisdiction} ${pack.data.version}`,
      })
    : pack.isSuccess && pack.data === null
      ? t("cab.immo.kicker.sansPack", { annee: exercice })
      : t("cab.immo.kicker.seul", { annee: exercice });

  /* ---- le formulaire du bien : nouveau sous le masthead, modifié dans la fiche */
  const formulaire = form ? (
    <form
      className="space-y-4 border border-border bg-card p-4"
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
                regles: cat
                  ? {
                      method: cat.method,
                      dureeAnnees: cat.dureeAnnees,
                      coefficient: cat.coefficient,
                    }
                  : null,
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
        {/* Un bien naît en service : l'état ne se choisit qu'à la modification. */}
        {form.id ? (
          <label className="space-y-1">
            <span className={LABEL}>{t("cab.immo.status")}</span>
            <select
              className={`${FIELD} w-full`}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as AssetForm["status"] })}
            >
              <option value="en_service">{t("cab.immo.status.en_service")}</option>
              <option value="cede">{t("cab.immo.status.cede")}</option>
              <option value="rebute">{t("cab.immo.status.rebute")}</option>
            </select>
          </label>
        ) : null}
      </div>
      {form.regles ? (
        <p className="num text-[11px] text-muted-foreground">
          {t("cab.immo.fromPack", {
            method: t(`cab.immo.method.${form.regles.method}`),
            duree: form.regles.dureeAnnees,
            coefficient: form.regles.coefficient,
          })}
        </p>
      ) : null}
      <div className="flex gap-2">
        <ActionButton
          type="submit"
          variant="ink"
          disabled={saveAsset.isPending || !form.regles || !pack.data}
        >
          {t("cab.immo.save")}
        </ActionButton>
        <ActionButton onClick={() => setForm(null)}>{t("cab.immo.cancel")}</ActionButton>
      </div>
    </form>
  ) : null;

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header className="border-b border-foreground pb-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="num text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {kicker}
            </p>
            <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
              {t("cab.immo.title")}
            </h1>
            <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.6] text-text-2">
              {t("cab.immo.lede")}
            </p>
          </div>
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3">
              <ClientPicker
                label={t("cab.queue.client")}
                clients={rows}
                value={client?.tenantId ?? null}
                onChange={(id) => {
                  setTenantId(id);
                  const choisi = rows.find((c) => c.tenantId === id);
                  if (choisi) ecrireDossierCourant({ id: choisi.tenantId, name: choisi.name });
                  setAssetId(null);
                }}
              />
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cab.immo.exercice")}
                </span>
                <select
                  value={exercice}
                  onChange={(e) => setExerciceChoisi(Number(e.target.value))}
                  className="num border border-border bg-card px-2.5 py-2 text-[13px]"
                >
                  {exercices.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <ActionButton
                variant="ink"
                disabled={!pack.data}
                onClick={() => {
                  setAssetId(null);
                  setForm(emptyForm());
                }}
              >
                {t("cab.immo.new")}
              </ActionButton>
            </div>
          ) : null}
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState>{t("cab.clients.empty")}</EmptyState>
      ) : (
        <>
          {error ? (
            <p
              className="border border-signal-stop px-3 py-2 text-[12px] text-signal-stop"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {pack.isSuccess && pack.data === null ? (
            <p className="border border-s-2 border-border border-s-marigold bg-card px-4 py-3 text-[12.5px] text-text-2">
              {t("cab.immo.sansPack")}
            </p>
          ) : null}

          {form && !form.id ? formulaire : null}

          {/* ---- les quatre chiffres */}
          <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.key} className="bg-card px-4 py-4">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {k.label}
                </p>
                <p className="num mt-3.5 whitespace-nowrap text-[22px] font-medium leading-none tracking-[-0.02em] lg:text-[24px]">
                  {k.value === null ? "—" : montant(k.value, locale)}
                  {client && k.value !== null ? (
                    <span className="ms-1.5 text-[11px] font-normal text-muted-foreground">
                      {client.currency}
                    </span>
                  ) : null}
                </p>
                <p className="mt-2.5 text-[11px] text-muted-foreground">{k.context}</p>
              </div>
            ))}
          </div>

          {/* ---- le registre */}
          <section className="space-y-3">
            <SectionTitle>{t("cab.immo.assets")}</SectionTitle>
            {assets.isPending ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : assetRows.length === 0 ? (
              <EmptyState>{t("cab.immo.empty")}</EmptyState>
            ) : (
              <div className="overflow-x-auto border border-border bg-card">
                <table className="min-w-full border-collapse text-[12.5px]">
                  <caption className="sr-only">{t("cab.immo.assets")}</caption>
                  <thead>
                    <tr className="border-b border-foreground">
                      <th scope="col" className={cn(TH, "text-start")}>
                        {t("cab.immo.asset")}
                      </th>
                      <th scope="col" className={cn(TH, "text-start")}>
                        {t("cab.immo.mes")}
                      </th>
                      <th scope="col" className={cn(TH, "text-start")}>
                        {t("cab.immo.col.methode")}
                      </th>
                      <th scope="col" className={cn(TH, "text-end")}>
                        {t("cab.immo.vb")}
                      </th>
                      <th scope="col" className={cn(TH, "text-end")}>
                        {t("cab.immo.col.dotation", { annee: exercice })}
                      </th>
                      <th scope="col" className={cn(TH, "text-end")}>
                        {t("cab.immo.vnc")}
                      </th>
                      <th scope="col" className={cn(TH, "text-end")} />
                    </tr>
                  </thead>
                  <tbody>
                    {registre.map(({ a, plan: p, s, constatee }) => {
                      const ouverte = a.id === asset?.id;
                      const enServiceLigne = a.status === "en_service";
                      const categorie = categorieDe(a);
                      return (
                        <tr
                          key={a.id}
                          className={cn(
                            "border-b border-border hover:bg-secondary/60",
                            ouverte && "bg-secondary/60",
                          )}
                        >
                          <td className="px-3 py-2 font-medium">
                            <button
                              type="button"
                              aria-expanded={ouverte}
                              title={t(ouverte ? "cab.immo.fiche.fermer" : "cab.immo.fiche.ouvrir")}
                              onClick={() => {
                                setForm(null);
                                setAssetId(ouverte ? null : a.id);
                              }}
                              className="text-start hover:underline"
                            >
                              {a.label}
                            </button>
                            {categorie ? (
                              <span className="block text-[10.5px] font-normal text-muted-foreground">
                                {categorie}
                              </span>
                            ) : null}
                            {!p ? (
                              <span className="block max-w-[34ch] text-[10.5px] font-normal leading-[1.35] text-signal-stop">
                                {t("cab.immo.calcul.illisible")}
                              </span>
                            ) : null}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-[11.5px]">
                            {dateLisible(a.miseEnService)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">{methodeDuree(a)}</td>
                          <td className="num whitespace-nowrap px-3 py-2 text-end">
                            {montant(a.valeurBrute, locale)}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-end">
                            {enServiceLigne && s?.ligne ? montant(s.ligne.dotation, locale) : "—"}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-end">
                            {enServiceLigne && s ? montant(s.vnc, locale) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-end">
                            {!enServiceLigne ? (
                              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                {t(`cab.immo.status.${a.status}`)}
                              </span>
                            ) : s?.ligne ? (
                              constatee ? (
                                <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-signal-ok">
                                  {t("cab.immo.recorded")}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={record.isPending}
                                  onClick={() => record.mutate({ assetId: a.id, exercice })}
                                  className="border border-foreground bg-foreground px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-background hover:bg-background hover:text-foreground disabled:opacity-40"
                                >
                                  {t("cab.immo.record")}
                                </button>
                              )
                            ) : s ? (
                              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                {t("cab.immo.amorti")}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---- la fiche du bien */}
          {asset ? (
            <section className="border border-foreground bg-card">
              <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {t("cab.immo.fiche")}
                  </p>
                  <h2 className="mt-1 text-[18px] font-semibold tracking-tight">{asset.label}</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {[categorieDe(asset), methodeDuree(asset), t(`cab.immo.status.${asset.status}`)]
                      .filter((x): x is string => !!x)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit ? (
                    <ActionButton onClick={() => setForm(fromAsset(asset))}>
                      {t("cab.immo.edit")}
                    </ActionButton>
                  ) : (
                    <span className="max-w-[40ch] text-[11px] text-muted-foreground">
                      {t("cab.immo.locked")}
                    </span>
                  )}
                  <ActionButton onClick={() => setAssetId(null)}>
                    {t("cab.immo.fiche.fermer")}
                  </ActionButton>
                </div>
              </header>

              <div className="space-y-6 px-4 py-4">
                {form && form.id === asset.id ? formulaire : null}

                {!plan ? (
                  <EmptyState>{t("cab.immo.calcul.illisible")}</EmptyState>
                ) : (
                  <>
                    {/* ---- le plan complet */}
                    <SectionRepliable
                      titre={t("cab.immo.plan")}
                      ouvert={volets.plan}
                      onBascule={() => basculer("plan")}
                      resume={t("cab.immo.plan.resume", { count: plan.lignes.length })}
                    >
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
                            <InkCell numeric>{montant(l.base, locale)}</InkCell>
                            <InkCell numeric>{montant(l.dotation, locale)}</InkCell>
                            <InkCell numeric>{montant(l.cumul, locale)}</InkCell>
                            <InkCell numeric>{montant(l.vnc, locale)}</InkCell>
                            <InkCell className="text-end">
                              {constatees.has(`${asset.id}:${l.exercice}`) ? (
                                <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-signal-ok">
                                  {t("cab.immo.recorded")}
                                </span>
                              ) : asset.status === "en_service" ? (
                                <button
                                  type="button"
                                  disabled={record.isPending}
                                  onClick={() =>
                                    record.mutate({ assetId: asset.id, exercice: l.exercice })
                                  }
                                  className="border border-foreground bg-foreground px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-background hover:bg-background hover:text-foreground disabled:opacity-40"
                                >
                                  {t("cab.immo.record")}
                                </button>
                              ) : null}
                            </InkCell>
                          </InkTableRow>
                        ))}
                      </InkTable>
                      <p className="num text-[11px] text-muted-foreground">
                        {t("cab.immo.totals", {
                          dotations: montant(plan.totals.dotations, locale),
                          vnc: montant(plan.totals.vnc_finale, locale),
                          currency: plan.currency,
                        })}
                      </p>
                    </SectionRepliable>

                    {/* ---- la cession */}
                    <SectionRepliable
                      titre={t("cab.immo.cession.title")}
                      ouvert={volets.cession}
                      onBascule={() => basculer("cession")}
                      resume={asset.status === "cede" ? t("cab.immo.status.cede") : undefined}
                    >
                      {asset.status === "cede" ? (
                        <p className="text-[12px] text-muted-foreground">
                          {t("cab.immo.cession.deja")}
                        </p>
                      ) : (
                        <div className="flex flex-wrap items-end gap-3 border border-border p-4">
                          <label className="space-y-1">
                            <span className={LABEL}>{t("cab.immo.cession.at")}</span>
                            <input
                              type="date"
                              className={`${FIELD} num`}
                              value={cessAt}
                              onChange={(e) => setCessAt(e.target.value)}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className={LABEL}>{t("cab.immo.cession.vnc")}</span>
                            <span className={`${FIELD} num block bg-muted`}>
                              {vncACession === null ? "—" : montant(vncACession, locale)}
                            </span>
                          </label>
                          <label className="space-y-1">
                            <span className={LABEL}>{t("cab.immo.cession.prix")}</span>
                            <input
                              inputMode="decimal"
                              className={`${FIELD} num`}
                              value={cessPrix}
                              onChange={(e) => setCessPrix(e.target.value)}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className={LABEL}>{t("cab.immo.cession.resultat")}</span>
                            <span className={`${FIELD} num block bg-muted`}>
                              {cession ? montant(cession.resultat, locale) : "—"}
                            </span>
                          </label>
                          <ActionButton
                            variant="ink"
                            onClick={() => recordCession.mutate()}
                            disabled={!cession || recordCession.isPending}
                          >
                            {t("cab.immo.cession.record")}
                          </ActionButton>
                        </div>
                      )}
                      {assetCessions.length > 0 ? (
                        <InkTable
                          caption={t("cab.immo.cession.title")}
                          head={[
                            t("cab.immo.cession.at"),
                            t("cab.immo.cession.prix"),
                            t("cab.immo.cession.vnc"),
                            t("cab.immo.cession.resultat"),
                          ]}
                        >
                          {assetCessions.map((c) => (
                            <InkTableRow key={c.id}>
                              <InkCell numeric>{dateLisible(c.at)}</InkCell>
                              <InkCell numeric>{montant(c.prix, locale)}</InkCell>
                              <InkCell numeric>{montant(c.vnc, locale)}</InkCell>
                              <InkCell numeric>{montant(c.resultat, locale)}</InkCell>
                            </InkTableRow>
                          ))}
                        </InkTable>
                      ) : null}
                    </SectionRepliable>

                    {/* ---- les dépréciations */}
                    <SectionRepliable
                      titre={t("cab.immo.dep.title")}
                      ouvert={volets.dep}
                      onBascule={() => basculer("dep")}
                      resume={t("cab.immo.dep.resume", { count: assetDepreciations.length })}
                    >
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
                          <span className={`${FIELD} num block bg-muted`}>
                            {vncNetteValue === null ? "—" : montant(vncNetteValue, locale)}
                          </span>
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
                          variant="ink"
                          onClick={() => recordDep.mutate()}
                          disabled={
                            !depreciation ||
                            estNul(depreciation.mouvement, decimals) ||
                            recordDep.isPending
                          }
                        >
                          {/* Le signe se lit sur la chaîne : aucun flottant sur un montant. */}
                          {depreciation?.mouvement.startsWith("-")
                            ? t("cab.immo.dep.reprise")
                            : t("cab.immo.dep.record")}
                        </ActionButton>
                      </div>
                      {depreciation ? (
                        <p className="num text-[11px] text-muted-foreground">
                          {t("cab.immo.dep.result", {
                            mouvement: montant(depreciation.mouvement, locale),
                            cumul: montant(depreciation.cumul_apres, locale),
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
                              <InkCell numeric>{dateLisible(d.at)}</InkCell>
                              <InkCell numeric>{montant(d.vnc, locale)}</InkCell>
                              <InkCell numeric>{montant(d.valeurRecouvrable, locale)}</InkCell>
                              <InkCell numeric>{montant(d.mouvement, locale)}</InkCell>
                              <InkCell numeric>{montant(d.cumul, locale)}</InkCell>
                              <InkCell>{d.note ?? "—"}</InkCell>
                            </InkTableRow>
                          ))}
                        </InkTable>
                      ) : (
                        <EmptyState>{t("cab.immo.dep.empty")}</EmptyState>
                      )}
                    </SectionRepliable>

                    {/* ---- les écritures du Socle */}
                    <SectionRepliable
                      titre={t("cab.immo.ecritures")}
                      ouvert={volets.ecritures}
                      onBascule={() => basculer("ecritures")}
                      resume={t("cab.immo.ecritures.resume", {
                        count: (ecritures.data ?? []).length,
                      })}
                    >
                      {(ecritures.data ?? []).length === 0 ? (
                        <EmptyState>{t("cab.immo.ecritures.empty")}</EmptyState>
                      ) : (
                        (ecritures.data ?? []).map((e) => (
                          <article key={e.id} className="space-y-2 border border-border p-4">
                            <header className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="text-[13px] font-semibold">{e.libelle}</h3>
                              <p className="num text-[11px] text-muted-foreground">
                                {e.journal} · {dateLisible(e.dateEcriture)} ·{" "}
                                {t(
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
                                  <InkCell numeric>{montant(l.debit, locale)}</InkCell>
                                  <InkCell numeric>{montant(l.credit, locale)}</InkCell>
                                </InkTableRow>
                              ))}
                            </InkTable>
                          </article>
                        ))
                      )}
                    </SectionRepliable>
                  </>
                )}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
