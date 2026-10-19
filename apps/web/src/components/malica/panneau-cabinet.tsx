/**
 * Le panneau de Malica, côté cabinet — ce qu'elle voit, ce qu'elle propose,
 * ce que ses agents font.
 *
 * ============================================================== POURQUOI
 *
 * Elle perçoit, rappelle et explique ; elle ne calcule jamais. Chaque phrase
 * de ce panneau est tirée de comptes réels — la file du cabinet, les
 * échéances dérivées du pack, les affectations — et chaque proposition dit
 * le moteur qui la fonde. Une proposition remise « à plus tard » l'est pour
 * la journée, sur ce poste : demain, si le fait demeure, elle revient.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { QueueItem } from "@malica/socle/ports/repositories";

import { useCabinet } from "./cabinet-context";

const CLE_REMISES = "malica.propositions.remises";
const JOUR_MS = 86_400_000;

interface Proposition {
  cle: string;
  texte: string;
  source: string;
  cta: string;
  to: string;
  params?: Record<string, string>;
}

interface Agent {
  cle: string;
  label: string;
  etat: string;
  ton: "ok" | "warn" | "stop";
}

/** Les propositions remises à plus tard aujourd'hui, sur ce poste. */
function remisesAujourdhui(): Set<string> {
  try {
    const brut = window.localStorage.getItem(CLE_REMISES);
    const carte = brut ? (JSON.parse(brut) as Record<string, string>) : {};
    const jour = new Date().toISOString().slice(0, 10);
    return new Set(
      Object.entries(carte)
        .filter(([, d]) => d === jour)
        .map(([k]) => k),
    );
  } catch {
    return new Set();
  }
}

function remettre(cle: string): void {
  try {
    const brut = window.localStorage.getItem(CLE_REMISES);
    const carte = brut ? (JSON.parse(brut) as Record<string, string>) : {};
    carte[cle] = new Date().toISOString().slice(0, 10);
    window.localStorage.setItem(CLE_REMISES, JSON.stringify(carte));
  } catch {
    // Stockage refusé : la proposition reviendra au prochain rendu, rien ne casse.
  }
}

export function PanneauCabinet() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [remises, setRemises] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : remisesAujourdhui(),
  );

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const ids = useMemo(() => (clients.data ?? []).map((c) => c.tenantId), [clients.data]);
  const queue = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });
  const reglages = useQuery({
    queryKey: ["cab-reglages", org.id],
    queryFn: () => office().parametrage.reglagesCabinet(org.id),
  });
  const affectations = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });
  const derivation = useQuery({
    queryKey: ["cab-echeances-derivation", org.id, ids],
    queryFn: () => office().collab.deriverEcheances(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
  const echeances = useQuery({
    queryKey: ["cab-echeances", org.id, ids],
    queryFn: () => office().collab.echeances(ids),
    enabled: ids.length > 0 && derivation.isFetched,
  });
  const annee = new Date().getUTCFullYear();
  const calendrier = useQuery({
    queryKey: ["cab-calendrier", org.id, annee, "*"],
    queryFn: () => office().parametrage.calendrierCabinet(org.id, annee, "*"),
  });

  const today = new Date().toISOString().slice(0, 10);
  const mois = today.slice(0, 7);
  const jours = (iso: string) =>
    Math.round(
      (new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() -
        new Date(`${today}T00:00:00Z`).getTime()) /
        JOUR_MS,
    );

  const rows = useMemo(() => queue.data ?? [], [queue.data]);
  const aSuperviser = rows.filter((r) => r.status === "comptabilisee");
  const plusAncienne = aSuperviser.reduce((max, r) => Math.max(max, -jours(r.createdAt)), 0);

  /* ---- les échéances dans leur délai de rappel */
  const rappelDe = useMemo(() => {
    const carte = new Map<string, number>();
    for (const o of calendrier.data ?? []) carte.set(o.code, o.rappelJours);
    return carte;
  }, [calendrier.data]);
  const alertes = (echeances.data ?? []).filter((e) => {
    if (e.status === "fait") return false;
    if (e.status === "en_retard") return true;
    const rappel = rappelDe.get(e.kind);
    return rappel !== undefined && jours(e.dueDate) <= rappel;
  });

  /* ---- les mandats sans main, les dossiers muets ce mois-ci */
  const affectes = new Set(
    (affectations.data ?? []).filter((a) => a.active).map((a) => a.clientTenantId),
  );
  const actifs = (clients.data ?? []).filter((c) => c.engagementStatus === "actif");
  const sansMain = actifs.filter((c) => !affectes.has(c.tenantId));
  const bavards = new Set(
    rows.filter((r) => r.createdAt.slice(0, 7) === mois).map((r) => r.tenantId),
  );
  const dormants = actifs.filter((c) => !bavards.has(c.tenantId));

  /* ---- le lot prêt, le doublon possible */
  const seuil = reglages.data?.seuilConfianceLot ?? null;

  /*
   * Les pièces qu'une RECETTE a lues ne comptent pas dans « le lot est prêt ».
   *
   * Elles portent `overall_confidence = 1` — le neutre du minimum, parce qu'une
   * recette ne produit aucun score — et ce neutre franchit tous les seuils.
   * Malica aurait donc annoncé un lot « au-dessus du seuil de confiance,
   * validable d'un geste » sur des pièces dont la confiance n'existe pas. Sa
   * phrase serait restée vraie sur le mot et fausse sur le fait, et c'est
   * exactement ce qu'un panneau ne doit jamais faire.
   */
  const idsPieces = useMemo(() => aSuperviser.map((r) => r.pieceId).sort(), [aSuperviser]);
  const parRecette = useQuery({
    queryKey: ["cab-par-recette", idsPieces],
    queryFn: () => office().fabrique.piecesLuesParRecette(idsPieces),
    enabled: idsPieces.length > 0,
  });
  const luesParRecette = useMemo(
    () => new Set((parRecette.data ?? []).map((p) => p.pieceId)),
    [parRecette.data],
  );
  const lot =
    seuil === null
      ? []
      : aSuperviser.filter(
          (r) =>
            !luesParRecette.has(r.pieceId) && r.confiance !== null && Number(r.confiance) >= seuil,
        );
  const doublon = useMemo(() => {
    const groupes = new Map<string, QueueItem[]>();
    for (const r of rows) {
      if (!r.montant) continue;
      const cle = `${r.tenantId}|${r.montant}|${(r.dateEcriture ?? r.createdAt).slice(0, 7)}`;
      groupes.set(cle, [...(groupes.get(cle) ?? []), r]);
    }
    return [...groupes.values()].find((g) => g.length >= 2) ?? null;
  }, [rows]);

  const propositions: Proposition[] = [];
  if (reglages.data?.propositionsProactives !== false) {
    if (lot.length > 0) {
      propositions.push({
        cle: "lot",
        texte: t("cab.malica.prop.lot", { count: lot.length }),
        source: t("cab.malica.prop.lot.source"),
        cta: t("cab.malica.prop.lot.cta"),
        to: "/cabinet/propositions",
      });
    }
    if (doublon) {
      propositions.push({
        cle: `doublon:${doublon[0]!.pieceId}`,
        texte: t("cab.malica.prop.doublon", { client: doublon[0]!.clientName }),
        source: t("cab.malica.prop.doublon.source"),
        cta: t("cab.malica.prop.doublon.cta"),
        to: "/cabinet/piece/$pieceId",
        params: { pieceId: doublon[0]!.pieceId },
      });
    }
    if (alertes.length > 0) {
      propositions.push({
        cle: "echeances",
        texte: t("cab.malica.prop.echeances", { count: alertes.length }),
        source: t("cab.malica.prop.echeances.source", {
          pack: pack.data ? `${org.jurisdiction} ${pack.data.version}` : org.jurisdiction,
        }),
        cta: t("cab.malica.prop.echeances.cta"),
        to: "/cabinet/echeances",
      });
    }
    if (sansMain.length > 0) {
      propositions.push({
        cle: "sansMain",
        texte: t("cab.malica.prop.sansMain", { count: sansMain.length }),
        source: t("cab.malica.prop.sansMain.source"),
        cta: t("cab.malica.prop.sansMain.cta"),
        to: "/cabinet/pilotage",
      });
    }
    if (dormants.length > 0 && rows.length > 0) {
      propositions.push({
        cle: "dormant",
        texte: t("cab.malica.prop.dormant", { count: dormants.length }),
        source: t("cab.malica.prop.dormant.source"),
        cta: t("cab.malica.prop.dormant.cta"),
        to: "/cabinet/clients",
      });
    }
  }
  const visibles = propositions.filter((p) => !remises.has(p.cle));

  const enFile = rows.filter((r) => r.status === "capturee" || r.status === "lue").length;
  const retours = rows.filter((r) => r.status === "retournee").length;
  const agents: Agent[] = [
    {
      cle: "lecture",
      label: t("cab.malica.agent.lecture"),
      etat:
        enFile > 0
          ? t("cab.malica.agent.lecture.file", { count: enFile })
          : t("cab.malica.agent.lecture.vide"),
      ton: "ok",
    },
    {
      cle: "echeances",
      label: t("cab.malica.agent.echeances"),
      etat:
        alertes.length > 0
          ? t("cab.malica.agent.echeances.alertes", { count: alertes.length })
          : t("cab.malica.agent.echeances.calme"),
      ton: alertes.some((e) => e.status === "en_retard")
        ? "stop"
        : alertes.length > 0
          ? "warn"
          : "ok",
    },
    {
      cle: "affectation",
      label: t("cab.malica.agent.affectation"),
      etat:
        sansMain.length > 0
          ? t("cab.malica.agent.affectation.sans", { count: sansMain.length })
          : t("cab.malica.agent.affectation.ok"),
      ton: sansMain.length > 0 ? "stop" : "ok",
    },
    {
      cle: "retours",
      label: t("cab.malica.agent.retours"),
      etat:
        retours > 0
          ? t("cab.malica.agent.retours.n", { count: retours })
          : t("cab.malica.agent.retours.zero"),
      ton: retours > 0 ? "warn" : "ok",
    },
  ];

  const lede: string = path.startsWith("/cabinet/piece/")
    ? t("cab.malica.lede.piece")
    : aSuperviser.length > 0
      ? t("cab.malica.lede.file", {
          count: aSuperviser.length,
          n: aSuperviser.length,
          jours: plusAncienne,
        })
      : t("cab.malica.lede.calme");

  const tonDe = (ton: Agent["ton"]) =>
    ton === "stop" ? "bg-signal-stop" : ton === "warn" ? "bg-marigold" : "bg-signal-ok";

  return (
    <div className="space-y-5" lang={locale}>
      <section>
        <Kicker cle="cab.malica.vois" />
        <p className="mt-1.5 text-[12.5px] leading-[1.55]">
          {queue.isPending ? t("common.loading") : lede}
        </p>
      </section>

      {visibles.length > 0 ? (
        <section>
          <Kicker cle="cab.malica.props" />
          <ul className="mt-2 space-y-2">
            {visibles.map((p) => (
              <li key={p.cle} className="border border-border bg-background p-3">
                <p className="text-[12.5px] leading-[1.5]">{p.texte}</p>
                <p className="num mt-1 text-[10px] text-muted-foreground">{p.source}</p>
                <div className="mt-2 flex items-center gap-3">
                  <Link
                    to={p.to}
                    {...(p.params ? { params: p.params } : {})}
                    className="border border-foreground bg-foreground px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-background hover:bg-marigold hover:text-foreground"
                  >
                    {p.cta}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      remettre(p.cle);
                      setRemises(new Set([...remises, p.cle]));
                    }}
                    className="text-[10.5px] text-muted-foreground hover:text-foreground"
                  >
                    {t("cab.malica.plusTard")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <Kicker cle="cab.malica.agents" />
        <ul className="mt-2 divide-y divide-border border border-border bg-background">
          {agents.map((a) => (
            <li key={a.cle} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[12px]">{a.label}</span>
              <span className="num flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span aria-hidden className={cn("inline-block h-[6px] w-[6px]", tonDe(a.ton))} />
                {a.etat}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[10.5px] italic leading-[1.45] text-muted-foreground">
        {t("cab.malica.promesse")}
      </p>
    </div>
  );
}

function Kicker({ cle }: { cle: MessageKey }) {
  const { t } = useI18n();
  return (
    <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
      {t(cle)}
    </p>
  );
}
