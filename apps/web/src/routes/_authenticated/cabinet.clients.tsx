/**
 * Clients — le portefeuille du cabinet.
 *
 * ============================================================== POURQUOI
 *
 * L'écran du design : quatre chiffres, des filtres, et une table où chaque
 * mandat se lit d'un coup d'œil — qui, quel régime, qui s'en occupe, ce qui
 * attend, ce qui est arrivé ce mois, qui valide. Un clic ouvre le dossier.
 *
 * Tout vient de l'API : les mandats et leurs comptes (`listClients`), la
 * file du cabinet pour ce qui est arrivé ce mois, les affectations et les
 * membres pour le collaborateur, la fiche fiscale de chaque client pour
 * son régime. Les valeurs que la base nomme en code — mode de validation,
 * statut d'engagement — sont traduites : aucun mot de machine à l'écran.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { OuvrirDossier } from "@/components/malica/OuvrirDossier";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionTitle,
  EnTeteCabinet,
} from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { initialesDe } from "@/lib/initiales";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { ClientSummary } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/clients")({
  head: () => ({
    meta: [
      { title: "Clients du cabinet — Malica Office" },
      {
        name: "description",
        content:
          "Les dossiers mandatés du cabinet, leur régime, leur collaborateur et le volume à superviser.",
      },
      { property: "og:title", content: "Clients du cabinet — Malica Office" },
      {
        property: "og:description",
        content:
          "Les dossiers mandatés du cabinet, leur régime, leur collaborateur et le volume à superviser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetClients,
});

type Filtre = "tous" | "attente" | "sans" | "miens";

const MODE: Record<string, MessageKey> = {
  autonome: "cab.mode.autonome",
  mandate: "cab.mode.mandate",
};
const ENGAGEMENT: Record<string, MessageKey> = {
  propose: "cab.engagement.propose",
  actif: "cab.engagement.actif",
  suspendu: "cab.engagement.suspendu",
  termine: "cab.engagement.termine",
};

function CabinetClients() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const queue = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const affectations = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });
  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });
  // La même clé que le rail du cabinet : une seule lecture du rôle.
  const acces = useQuery({
    queryKey: ["cab-acces", org.id],
    queryFn: () => office().acces.monAcces(org.id),
  });
  const regimes = useQuery({
    queryKey: ["fiche-regimes", org.jurisdiction],
    queryFn: () => office().identity.regimesDisponibles(org.jurisdiction),
  });
  const rows = useMemo(() => clients.data ?? [], [clients.data]);
  // La fiche de chaque client, pour son régime : une requête par mandat,
  // mise en cache par client — un cabinet en a des dizaines, pas des milliers.
  const fiches = useQueries({
    queries: rows.map((c) => ({
      queryKey: ["fiche", c.tenantId],
      queryFn: () => office().identity.ficheCourante(c.tenantId),
    })),
  });

  useMalicaPanel(<MalicaNote>{t("cab.malica.queue")}</MalicaNote>, [locale]);

  /* ---- le collaborateur de chaque client */
  const collabDe = useMemo(() => {
    const parUser = new Map((membres.data ?? []).map((m) => [m.userId, m.email]));
    const carte = new Map<string, string>();
    for (const a of (affectations.data ?? []).filter((x) => x.active)) {
      const email = parUser.get(a.collaboratorId);
      if (email && !carte.has(a.clientTenantId)) carte.set(a.clientTenantId, email);
    }
    return carte;
  }, [membres.data, affectations.data]);

  /* ---- ce qui est arrivé ce mois, par client */
  const ceMois = useMemo(() => {
    const debut = new Date();
    debut.setUTCDate(1);
    debut.setUTCHours(0, 0, 0, 0);
    const carte = new Map<string, number>();
    for (const r of queue.data ?? []) {
      if (new Date(r.createdAt) < debut) continue;
      carte.set(r.tenantId, (carte.get(r.tenantId) ?? 0) + 1);
    }
    return carte;
  }, [queue.data]);

  const regimeDe = (index: number): string => {
    const fiche = fiches[index]?.data;
    const code = fiche?.regimeImposition ?? null;
    if (!code) return t("cab.clients.regime.inconnu");
    return (
      (regimes.data ?? []).find((r) => r.axe === "imposition" && r.code === code)?.libelle ?? code
    );
  };

  /* ---- les chiffres */
  const attente = rows.reduce((s, c) => s + c.counts.comptabilisee, 0);
  const sans = rows.filter((c) => !collabDe.has(c.tenantId)).length;
  const retournees = rows.reduce((s, c) => s + c.counts.retournee, 0);
  const moi = compte.data?.email ?? null;

  /* ---- les filtres */
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const visibles = rows.filter((c) => {
    if (filtre === "attente") return c.counts.comptabilisee > 0;
    if (filtre === "sans") return !collabDe.has(c.tenantId);
    if (filtre === "miens") return moi !== null && collabDe.get(c.tenantId) === moi;
    return true;
  });
  const compteDe = (f: Filtre) =>
    f === "tous"
      ? rows.length
      : f === "attente"
        ? rows.filter((c) => c.counts.comptabilisee > 0).length
        : f === "sans"
          ? sans
          : rows.filter((c) => moi !== null && collabDe.get(c.tenantId) === moi).length;

  return (
    <div className="space-y-8">
      <EnTeteCabinet
        surtitre={<>{t("cab.clients.kicker")}</>}
        titre={<>{t("cab.clients.title")}</>}
        chapeau={<>{t("cab.clients.lede")}</>}
      />

      {/* Seul un expert ouvre un dossier au nom du cabinet — la base le refuse à tout autre. */}
      {acces.data?.role === "expert" ? <OuvrirDossier cabinetId={org.id} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            key: "mandats",
            label: t("cab.clients.kpi.mandats"),
            // « Mandats actifs » : ni le révoqué, ni le refusé (ANO-013).
            value: rows.filter((c) => c.engagementStatus === "actif").length,
            tone: "",
          },
          {
            key: "attente",
            label: t("cab.clients.kpi.attente"),
            value: attente,
            tone: attente ? "text-marigold" : "",
          },
          {
            key: "sans",
            label: t("cab.clients.kpi.sans"),
            value: sans,
            tone: sans ? "text-signal-warn" : "",
          },
          {
            key: "retournees",
            label: t("cab.kpi.returned"),
            value: retournees,
            tone: retournees ? "text-signal-stop" : "",
          },
        ].map((k) => (
          <div key={k.key} className="border border-border bg-card px-4 py-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {k.label}
            </p>
            <p className={cn("num mt-1.5 text-[28px] leading-none", k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <SectionTitle
          action={
            <span className="num text-[11px] text-muted-foreground">
              {t("cab.clients.count", { count: visibles.length })}
            </span>
          }
        >
          {t("cab.clients.mandate")}
        </SectionTitle>
        <div className="flex flex-wrap border border-border">
          {(
            [
              ["tous", "cab.clients.filter.tous"],
              ["attente", "cab.clients.filter.attente"],
              ["sans", "cab.clients.filter.sans"],
              ["miens", "cab.clients.filter.miens"],
            ] as Array<[Filtre, MessageKey]>
          ).map(([f, cle]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltre(f)}
              aria-pressed={filtre === f}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]",
                filtre === f ? "bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
            >
              {t(cle)}
              <span className="num font-normal opacity-70">{compteDe(f)}</span>
            </button>
          ))}
        </div>

        {clients.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : visibles.length === 0 ? (
          <EmptyState>{t("cab.clients.empty")}</EmptyState>
        ) : (
          <InkTable
            caption={t("cab.clients.title")}
            head={[
              t("cab.clients.mandate"),
              t("cab.clients.col.regime"),
              t("cab.clients.col.collab"),
              t("cab.kpi.review"),
              t("cab.clients.col.mois"),
              t("cab.kpi.returned"),
              t("cab.clients.mode"),
              "",
            ]}
          >
            {visibles.map((client) => (
              <LigneClient
                key={client.tenantId}
                client={client}
                regime={regimeDe(rows.indexOf(client))}
                collab={collabDe.get(client.tenantId) ?? null}
                mois={ceMois.get(client.tenantId) ?? 0}
              />
            ))}
          </InkTable>
        )}
      </section>
    </div>
  );
}

function LigneClient({
  client,
  regime,
  collab,
  mois,
}: {
  client: ClientSummary;
  regime: string;
  collab: string | null;
  mois: number;
}) {
  const { t } = useI18n();
  const engagement = ENGAGEMENT[client.engagementStatus];
  return (
    <InkTableRow>
      <InkCell>
        <Link
          to="/cabinet/dossier/$clientId"
          params={{ clientId: client.tenantId }}
          className="block font-medium hover:underline"
        >
          {client.name}
        </Link>
        <span className="num block text-[10.5px] text-muted-foreground">
          {client.legalId ?? "—"}
          {engagement && client.engagementStatus !== "actif" ? ` · ${t(engagement)}` : ""}
        </span>
      </InkCell>
      <InkCell>
        <span className="text-[12px]">{regime}</span>
      </InkCell>
      <InkCell>
        {collab ? (
          <span className="flex items-center gap-1.5 text-[12px]">
            <span className="num bg-foreground px-1 text-[9px] text-background">
              {initialesDe(collab)}
            </span>
            <span className="truncate">{collab}</span>
          </span>
        ) : (
          <span className="text-[12px] text-signal-warn">{t("cab.clients.collab.aucun")}</span>
        )}
      </InkCell>
      <InkCell numeric>
        <span
          className={cn(client.counts.comptabilisee ? "text-marigold" : "text-muted-foreground")}
        >
          {client.counts.comptabilisee}
        </span>
      </InkCell>
      <InkCell numeric>{mois}</InkCell>
      <InkCell numeric>
        <span
          className={cn(client.counts.retournee ? "text-signal-stop" : "text-muted-foreground")}
        >
          {client.counts.retournee}
        </span>
      </InkCell>
      <InkCell>
        <span className="border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
          {t(MODE[client.validationMode] ?? "cab.mode.mandate")}
        </span>
      </InkCell>
      <InkCell>
        <Link
          to="/cabinet/dossier/$clientId"
          params={{ clientId: client.tenantId }}
          className="border border-border px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
        >
          {t("cab.queue.open")}
        </Link>
      </InkCell>
    </InkTableRow>
  );
}
