/**
 * La coquille du cabinet.
 *
 * ============================================================== POURQUOI
 *
 * Trois colonnes, comme le design : un rail repliable à gauche (254 px
 * ouvert, 64 px replié), la colonne de travail, le panneau de Malica à
 * droite (320 px). Une barre du haut porte le fil d'Ariane, la recherche,
 * la cloche et le bouton de Malica. Un bandeau de dossier apparaît quand
 * on visite un client.
 *
 * Le rail suit la doctrine de navigation du design : « ce qui traverse les
 * clients est en haut, le dossier d'un client est un lieu qu'on visite,
 * l'administration est en bas ». Ses badges sont des comptes RÉELS — la
 * file à superviser, les notifications non lues, les mandats — pas des
 * chiffres de maquette.
 *
 * Rien ici ne décide de comptabilité : la coquille situe, elle ne juge pas.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  Coins,
  MessageSquare,
  Boxes,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Gauge,
  Inbox,
  Landmark,
  ListChecks,
  Menu,
  Search,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CabinetProvider } from "@/components/malica/cabinet-context";
import { useDossierCourant } from "@/components/malica/dossier-courant";
import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import {
  EmptyState,
  MalicaAvatar,
  MalicaPanel,
  MalicaPoignee,
} from "@/components/malica/office-ui";
import { PanneauCabinet } from "@/components/malica/panneau-cabinet";
import { usePanneauMalica } from "@/components/malica/panneau-malica";
import { MalicaChat } from "@/components/malica/MalicaChat";
import { useI18n, type MessageKey } from "@/i18n";
import { initialesDe } from "@/lib/initiales";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { ClientSummary, MonAcces, Organization } from "@malica/socle/ports/repositories";
import { EcranPlein } from "@/components/EcranPlein";

export const Route = createFileRoute("/_authenticated/cabinet")({
  head: () => ({
    meta: [
      { title: "Supervision cabinet — Malica Office" },
      {
        name: "description",
        content:
          "File priorisée, écran côte-à-côte pièce et écriture, retour avec motif gouverné et contre-passation datée.",
      },
      { property: "og:title", content: "Supervision cabinet — Malica Office" },
      {
        property: "og:description",
        content: "File priorisée, revue côte-à-côte, retour avec motif gouverné.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetLayout,
});

/* ----------------------------------------------------------------- le rail */

interface Entree {
  to: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
  /** Un compte réel, ou rien. */
  badge?: number;
  /** Le badge parle d'une attente (or) plutôt que d'un volume (encre). */
  attente?: boolean;
}

interface Groupe {
  key: string;
  label: string;
  items: Entree[];
}

/**
 * Les écrans d'un dossier. La synthèse est propre au client ; les autres
 * sont des écrans du cabinet qui portent leur propre sélecteur de client.
 * Ils vivent en onglets du dossier courant, jamais dans le rail.
 */
const ONGLETS_DU_DOSSIER: Array<{ to: string; label: MessageKey; icon: LucideIcon }> = [
  { to: "/cabinet/propositions", label: "cab.nav.propositions", icon: ListChecks },
  { to: "/cabinet/rapprochement", label: "cab.nav.banque", icon: Landmark },
  { to: "/cabinet/echeances", label: "cab.nav.echeances", icon: CalendarClock },
  { to: "/cabinet/immobilisations", label: "cab.nav.immo", icon: Building2 },
  { to: "/cabinet/stocks", label: "cab.nav.stocks", icon: Boxes },
  { to: "/cabinet/pv", label: "cab.nav.pv", icon: FileText },
];

const CLE_RAIL = "cabinet.rail.replie";

/** Le rôle de la personne, dans sa langue — la plateforme d'abord, parce qu'elle voit tout. */
function libelleDuRole(acces: MonAcces | null, t: (k: MessageKey) => string): string {
  if (!acces) return "";
  if (acces.plateforme) return t("cab.rail.role.plateforme");
  const CLES: Record<string, MessageKey> = {
    expert: "cab.rail.role.expert",
    dirigeant: "cab.rail.role.dirigeant",
    collaborateur: "cab.rail.role.collaborateur",
    assistant: "cab.rail.role.assistant",
  };
  const cle = acces.role ? CLES[acces.role] : undefined;
  return cle ? t(cle) : t("cab.rail.role.aucun");
}

function railReplieAuDepart(): boolean {
  try {
    return window.localStorage.getItem(CLE_RAIL) === "1";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- la coquille */

function CabinetLayout() {
  const { t } = useI18n();
  const malica = usePanneauMalica("cabinet");
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const cabinets = useQuery({
    queryKey: ["my-cabinets"],
    queryFn: () => office().supervision.listMyCabinets(),
  });
  const org = (cabinets.data ?? [])[0] ?? null;

  const orgsQuery = useQuery({
    queryKey: ["my-organizations"],
    queryFn: () => office().identity.listMyOrganizations(),
  });
  const hasPme = (orgsQuery.data ?? []).some((o) => o.kind === "pme");

  useEffect(() => {
    if (cabinets.isPending) return;
    if (!org && hasPme) void navigate({ to: "/office" });
  }, [cabinets.isPending, org, hasPme, navigate]);

  if (cabinets.isPending) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </main>
    );
  }

  if (!org) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
        <h1 className="text-xl font-semibold tracking-tight">{t("cab.brand")}</h1>
        <EmptyState>{t("cab.noorg")}</EmptyState>
        <Link
          to="/onboarding"
          className="inline-block border border-foreground bg-foreground px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-background"
        >
          {t("app.orgs.create")}
        </Link>
      </main>
    );
  }

  return (
    <CabinetProvider
      org={org}
      render={({ panel }) => (
        <Coquille
          org={org}
          hasPme={hasPme}
          path={path}
          panneauOuvert={malica.ouvert}
          ouvrirPanneau={malica.ouvrir}
          fermerPanneau={malica.fermer}
          panel={panel}
        />
      )}
    />
  );
}

function Coquille({
  org,
  hasPme,
  path,
  panneauOuvert,
  ouvrirPanneau,
  fermerPanneau,
  panel,
}: {
  org: Organization;
  hasPme: boolean;
  path: string;
  panneauOuvert: boolean;
  ouvrirPanneau: () => void;
  fermerPanneau: () => void;
  panel: React.ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const dossierCourant = useDossierCourant();

  const [replie, setReplie] = useState(false);
  useEffect(() => setReplie(railReplieAuDepart()), []);
  const basculerRail = useCallback(() => {
    setReplie((r) => {
      try {
        window.localStorage.setItem(CLE_RAIL, r ? "0" : "1");
      } catch {
        // Stockage inaccessible : le choix vaut pour la séance.
      }
      return !r;
    });
  }, []);

  const [tiroir, setTiroir] = useState(false);
  useEffect(() => setTiroir(false), [path]);

  /* ---- les comptes réels qui deviennent des badges */
  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const queue = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });
  const clientIds = useMemo(() => (clients.data ?? []).map((c) => c.tenantId), [clients.data]);
  const notifications = useQuery({
    queryKey: ["cab-notifications", org.id, clientIds],
    queryFn: () => office().collab.notifications(clientIds),
    enabled: clientIds.length > 0,
  });
  // Les badges du conseil et des honoraires : des comptes réels, comme les autres.
  const conseil = useQuery({
    queryKey: ["cab-conseil-stats", org.id],
    queryFn: () => office().conseil.statistiques(org.id),
  });
  const honoraires = useQuery({
    queryKey: ["cab-honoraires-synthese", org.id, new Date().toISOString().slice(0, 7)],
    queryFn: () => office().honoraires.synthese(org.id, new Date().toISOString().slice(0, 7)),
  });
  const aSuperviser = (queue.data ?? []).filter((r) => r.status === "comptabilisee").length;
  const nonLues = (notifications.data ?? []).filter((n) => !n.readAt).length;
  const nbClients = (clients.data ?? []).length;

  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });
  // Qui je suis ici : le pied du rail le dit, et les lectures filtrent sur la même règle.
  const acces = useQuery({
    queryKey: ["cab-acces", org.id],
    queryFn: () => office().acces.monAcces(org.id),
  });

  const groupes: Groupe[] = [
    {
      key: "file",
      label: t("cab.nav.group.file"),
      items: [
        { to: "/cabinet", label: t("cab.nav.today"), icon: Inbox, exact: true, badge: aSuperviser },
        {
          to: "/cabinet/conseil",
          label: t("cab.nav.conseil"),
          icon: MessageSquare,
          exact: false,
          badge: conseil.data?.totaux.enAttente ?? 0,
          attente: true,
        },
        {
          to: "/cabinet/notifications",
          label: t("cab.nav.notifications"),
          icon: Bell,
          exact: false,
          badge: nonLues,
          attente: true,
        },
      ],
    },
    {
      key: "portefeuille",
      label: t("cab.nav.group.portefeuille"),
      items: [
        {
          to: "/cabinet/clients",
          label: t("cab.nav.clients"),
          icon: Users,
          exact: true,
          badge: nbClients,
        },
        {
          to: "/cabinet/honoraires",
          label: t("cab.nav.honoraires"),
          icon: Coins,
          exact: false,
          badge: honoraires.data?.nbRetard ?? 0,
          attente: true,
        },
      ],
    },
    {
      key: "cabinet",
      label: t("cab.nav.group.cabinet"),
      items: [
        { to: "/cabinet/pilotage", label: t("cab.nav.pilotage"), icon: Gauge, exact: false },
        { to: "/cabinet/plan", label: t("cab.nav.plan"), icon: BookOpen, exact: false },
        { to: "/cabinet/export", label: t("cab.nav.export"), icon: Download, exact: false },
        { to: "/cabinet/reglages", label: t("cab.nav.settings"), icon: Settings2, exact: false },
      ],
    },
  ];
  // La recherche et le fil d'Ariane connaissent aussi les onglets du dossier.
  const groupesDeRecherche: Groupe[] = [
    ...groupes,
    {
      key: "dossier",
      label: dossierCourant?.name ?? t("cab.nav.dossier"),
      items: ONGLETS_DU_DOSSIER.map((o) => ({
        to: o.to,
        label: t(o.label),
        icon: o.icon,
        exact: false,
      })),
    },
  ];

  const estActive = (e: Entree) => (e.exact ? path === e.to : path.startsWith(e.to));

  /* ---- le fil d'Ariane : le groupe, puis l'entrée */
  const fil = (() => {
    for (const g of groupesDeRecherche) {
      for (const e of g.items) {
        if (estActive(e)) return { section: g.label, detail: e.label };
      }
    }
    if (path.startsWith("/cabinet/piece/")) {
      return { section: t("cab.nav.group.file"), detail: t("cab.review.title") };
    }
    if (path.startsWith("/cabinet/dossier/")) {
      return { section: t("cab.nav.group.portefeuille"), detail: t("cab.nav.dossier") };
    }
    return { section: t("cab.brand"), detail: "" };
  })();

  const dossierVisite = path.startsWith("/cabinet/dossier/") ? (path.split("/")[3] ?? null) : null;
  // Sur un onglet du dossier, le bandeau suit le dossier courant.
  const dossierAffiche =
    dossierVisite ??
    (ONGLETS_DU_DOSSIER.some((o) => path.startsWith(o.to)) ? (dossierCourant?.id ?? null) : null);

  // Tailwind ne génère pas une classe composée à l'exécution : la grille
  // lit une variable CSS, posée ici selon le rail et le panneau.
  const largeurRail = replie ? "64px" : "254px";
  const colonnes = panneauOuvert
    ? `${largeurRail} minmax(0,1fr) 320px`
    : `${largeurRail} minmax(0,1fr)`;

  return (
    <div
      className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[var(--cabinet-colonnes)]"
      style={{ "--cabinet-colonnes": colonnes } as React.CSSProperties}
    >
      <Rail
        org={org}
        hasPme={hasPme}
        groupes={groupes}
        estActive={estActive}
        replie={replie}
        basculer={basculerRail}
        nbClients={nbClients}
        clients={clients.data ?? []}
        email={compte.data?.email ?? null}
        role={libelleDuRole(acces.data ?? null, t)}
        ouvert={tiroir}
        fermerTiroir={() => setTiroir(false)}
      />

      <main className="min-w-0 lg:h-screen lg:overflow-y-auto">
        <BarreDuHaut
          section={fil.section}
          detail={fil.detail}
          nonLues={nonLues}
          panneauOuvert={panneauOuvert}
          basculerPanneau={panneauOuvert ? fermerPanneau : ouvrirPanneau}
          ouvrirTiroir={() => setTiroir(true)}
          clients={clients.data ?? []}
          groupes={groupesDeRecherche}
        />
        {dossierAffiche ? (
          <BandeauDossier
            clientId={dossierAffiche}
            clients={clients.data ?? []}
            onChanger={(id) =>
              void navigate({ to: "/cabinet/dossier/$clientId", params: { clientId: id } })
            }
          />
        ) : null}
        <div className="px-4 py-6 sm:px-6 lg:px-9 lg:py-7">
          <Outlet />
          {panneauOuvert ? (
            <section className="mt-8 border border-border bg-card lg:hidden">
              <MalicaPanel
                title={t("cab.malica.title")}
                status={t("cab.malica.status")}
                footer={<MalicaChat tenantId={org.id} technique />}
                framed={false}
                onFermer={fermerPanneau}
                fermerLibelle={t("malica.panneau.fermer")}
              >
                <PanneauCabinet />
                {panel ? <div className="mt-5 border-t border-border pt-4">{panel}</div> : null}
              </MalicaPanel>
            </section>
          ) : (
            <MalicaPoignee
              nom={t("cab.malica.title")}
              libelle={t("malica.panneau.ouvrir")}
              onOuvrir={ouvrirPanneau}
              className="mt-8 lg:hidden"
            />
          )}
        </div>
      </main>

      {panneauOuvert ? (
        <div className="hidden border-s border-border lg:block lg:h-screen lg:overflow-y-auto">
          <MalicaPanel
            title={t("cab.malica.title")}
            status={t("cab.malica.status")}
            footer={<MalicaChat tenantId={org.id} technique />}
            onFermer={fermerPanneau}
            fermerLibelle={t("malica.panneau.fermer")}
          >
            <PanneauCabinet />
            {panel ? <div className="mt-5 border-t border-border pt-4">{panel}</div> : null}
          </MalicaPanel>
        </div>
      ) : (
        <MalicaPoignee
          nom={t("cab.malica.title")}
          libelle={t("malica.panneau.ouvrir")}
          onOuvrir={ouvrirPanneau}
          className="fixed bottom-5 end-5 hidden lg:flex"
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ le rail */

function Rail({
  org,
  hasPme,
  groupes,
  estActive,
  replie,
  basculer,
  nbClients,
  clients,
  email,
  role,
  ouvert,
  fermerTiroir,
}: {
  org: Organization;
  hasPme: boolean;
  groupes: Groupe[];
  estActive: (e: Entree) => boolean;
  replie: boolean;
  basculer: () => void;
  nbClients: number;
  clients: ClientSummary[];
  email: string | null;
  role: string;
  ouvert: boolean;
  fermerTiroir: () => void;
}) {
  const { t } = useI18n();
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });
  const [recherche, setRecherche] = useState("");

  const contenu = (
    <>
      {/* En-tête : la marque, le cabinet, le nombre de mandats, le repli. */}
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border px-3 py-3",
          replie ? "flex-col" : "",
        )}
      >
        <span aria-hidden className="h-5 w-5 shrink-0 bg-foreground" />
        {!replie ? (
          <span className="min-w-0 flex-1">
            <Link
              to="/office"
              className="block truncate text-[14.5px] font-semibold tracking-[-0.012em]"
            >
              {org.name}
            </Link>
            <span className="num mt-0.5 block text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
              {org.jurisdiction} · {t("cab.rail.mandats", { count: nbClients })}
            </span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={basculer}
          title={replie ? t("cab.rail.expand") : t("cab.rail.reduce")}
          aria-label={replie ? t("cab.rail.expand") : t("cab.rail.reduce")}
          aria-expanded={!replie}
          className="hidden h-7 w-7 shrink-0 items-center justify-center border border-border bg-card text-muted-foreground hover:bg-accent lg:flex"
        >
          {replie ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Tout chercher : une recherche dans le rail, sur les écrans et les clients. */}
      {!replie ? (
        <div className="px-3 pt-3">
          <label className="flex items-center gap-2 border border-border bg-card px-2.5 py-2 text-muted-foreground focus-within:border-foreground">
            <Search size={14} className="shrink-0" />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t("cab.search")}
              aria-label={t("cab.top.searchAria")}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="num border border-border px-1 py-0.5 text-[9.5px]">⌘K</span>
          </label>
          {recherche.trim() ? (
            <Resultats
              recherche={recherche}
              clients={clients}
              groupes={groupes}
              onChoisi={() => {
                setRecherche("");
                fermerTiroir();
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* Les groupes. */}
      <div className={cn("flex-1 overflow-y-auto py-3", replie ? "px-2" : "px-3")}>
        {groupes.map((g) => (
          <div key={g.key} className="mb-4">
            {!replie ? (
              <p className="mb-1.5 px-2.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {g.label}
              </p>
            ) : (
              <span aria-hidden className="mx-2 mb-2 block h-px bg-border" />
            )}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((e) => {
                const actif = estActive(e);
                const Icone = e.icon;
                return (
                  <li key={e.to}>
                    <Link
                      to={e.to}
                      title={e.label}
                      aria-current={actif ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 py-2 text-[13px]",
                        replie ? "justify-center px-0" : "px-2.5",
                        actif
                          ? "bg-accent font-medium text-foreground"
                          : "text-text-2 hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-0 start-0 w-0.5",
                          actif ? "bg-foreground" : "bg-transparent",
                        )}
                      />
                      <Icone size={17} strokeWidth={1.9} className="shrink-0" />
                      {!replie ? (
                        <>
                          <span className="min-w-0 flex-1 truncate">{e.label}</span>
                          {e.badge ? (
                            <span
                              className={cn(
                                "num text-[10.5px]",
                                e.attente ? "text-marigold" : "text-muted-foreground",
                              )}
                            >
                              {e.badge}
                            </span>
                          ) : null}
                        </>
                      ) : e.badge && e.attente ? (
                        <span
                          aria-hidden
                          className="absolute end-2 top-1.5 h-1.5 w-1.5 bg-marigold"
                        />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Pied : le pack, la langue, le compte. */}
      <div
        className={cn("flex flex-col gap-2 border-t border-border py-3", replie ? "px-2" : "px-3")}
      >
        {!replie ? (
          <>
            <div className="flex items-center justify-between gap-2 border border-border bg-card px-2.5 py-2">
              <span className="min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t("cab.rail.pack")}
                </span>
                <span className="num mt-1 block text-[11.5px]">
                  {pack.data ? `${pack.data.jurisdiction} · ${pack.data.version}` : t("pack.none")}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "h-[7px] w-[7px] shrink-0",
                  pack.data?.ratified ? "bg-signal-ok" : "bg-signal-warn",
                )}
              />
            </div>
            <LanguageSwitcher />
          </>
        ) : null}
        <div
          className={cn(
            "flex items-center gap-2.5 border border-border bg-card",
            replie ? "justify-center p-1.5" : "px-2.5 py-2",
          )}
          title={email ?? ""}
        >
          <span className="num flex h-7 w-7 shrink-0 items-center justify-center bg-foreground text-[10.5px] font-semibold text-background">
            {email ? initialesDe(email) : "—"}
          </span>
          {!replie ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{email ?? "—"}</span>
              <span className="block text-[10.5px] text-muted-foreground">{role}</span>
            </span>
          ) : null}
        </div>
        {hasPme && !replie ? (
          <Link
            to="/office"
            className="border border-border px-2.5 py-2 text-center text-[10px] font-semibold uppercase tracking-wide hover:bg-accent"
          >
            {t("portal.switch")}
          </Link>
        ) : null}
      </div>
    </>
  );

  return (
    <>
      {/* Large : le rail, collant. */}
      <nav
        aria-label={t("cab.brand")}
        className="hidden flex-col border-e border-border bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen"
      >
        {contenu}
      </nav>
      {/* Étroit : un tiroir. */}
      {ouvert ? (
        <EcranPlein className="fixed inset-0 z-40 flex lg:hidden">
          <button
            type="button"
            aria-label={t("malica.panneau.fermer")}
            onClick={fermerTiroir}
            className="flex-1 bg-foreground/30"
          />
          <nav
            aria-label={t("cab.brand")}
            className="flex w-[280px] flex-col overflow-y-auto bg-sidebar"
          >
            {contenu}
          </nav>
        </EcranPlein>
      ) : null}
    </>
  );
}

/** Ce que « Tout chercher » trouve : des écrans, des clients. */
function Resultats({
  recherche,
  clients,
  groupes,
  onChoisi,
}: {
  recherche: string;
  clients: ClientSummary[];
  groupes: Groupe[];
  onChoisi: () => void;
}) {
  const { t } = useI18n();
  const q = recherche.trim().toLocaleLowerCase();
  const ecrans = groupes
    .flatMap((g) => g.items)
    .filter((e) => e.label.toLocaleLowerCase().includes(q));
  const trouves = clients.filter((c) => c.name.toLocaleLowerCase().includes(q)).slice(0, 8);
  if (ecrans.length === 0 && trouves.length === 0) {
    return (
      <p className="mt-1 px-2.5 py-2 text-[12px] text-muted-foreground">{t("cab.palette.none")}</p>
    );
  }
  return (
    <div className="mt-1 border border-border bg-card">
      {ecrans.length > 0 ? (
        <div className="py-1">
          <p className="px-2.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.palette.screens")}
          </p>
          {ecrans.map((e) => (
            <Link
              key={e.to}
              to={e.to}
              onClick={onChoisi}
              className="block px-2.5 py-1.5 text-[12.5px] hover:bg-accent"
            >
              {e.label}
            </Link>
          ))}
        </div>
      ) : null}
      {trouves.length > 0 ? (
        <div className="border-t border-border py-1">
          <p className="px-2.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.palette.clients")}
          </p>
          {trouves.map((c) => (
            <Link
              key={c.tenantId}
              to="/cabinet/dossier/$clientId"
              params={{ clientId: c.tenantId }}
              onClick={onChoisi}
              className="block px-2.5 py-1.5 text-[12.5px] hover:bg-accent"
            >
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- la barre du haut */

function BarreDuHaut({
  section,
  detail,
  nonLues,
  panneauOuvert,
  basculerPanneau,
  ouvrirTiroir,
  clients,
  groupes,
}: {
  section: string;
  detail: string;
  nonLues: number;
  panneauOuvert: boolean;
  basculerPanneau: () => void;
  ouvrirTiroir: () => void;
  clients: ClientSummary[];
  groupes: Groupe[];
}) {
  const { t } = useI18n();
  const [recherche, setRecherche] = useState("");
  const [ouverte, setOuverte] = useState(false);
  const champ = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl+K : la recherche, depuis n'importe quel écran.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOuverte(true);
        setTimeout(() => champ.current?.focus(), 0);
      }
      if (e.key === "Escape") setOuverte(false);
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-9">
      <button
        type="button"
        onClick={ouvrirTiroir}
        aria-label={t("cab.top.menu")}
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center border border-border bg-card lg:hidden"
      >
        <Menu size={16} />
      </button>
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
        <span className="font-semibold text-foreground">{section}</span>
        {detail ? (
          <>
            <span className="text-border"> / </span>
            {detail}
          </>
        ) : null}
      </p>
      <div className="relative hidden lg:block">
        <button
          type="button"
          onClick={() => {
            setOuverte((o) => !o);
            setTimeout(() => champ.current?.focus(), 0);
          }}
          className="flex items-center gap-2 border border-border bg-card px-2.5 py-1.5 text-muted-foreground hover:bg-accent"
        >
          <Search size={14} />
          <span className="text-[12px] whitespace-nowrap">{t("cab.top.search")}</span>
          <span className="num border border-border px-1 py-0.5 text-[9.5px]">⌘K</span>
        </button>
        {ouverte ? (
          <div className="absolute end-0 top-full z-40 mt-1 w-[360px] border border-border bg-card p-2 shadow-none">
            <input
              ref={champ}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t("cab.top.search")}
              aria-label={t("cab.top.searchAria")}
              className="w-full border border-border bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-foreground"
            />
            {recherche.trim() ? (
              <Resultats
                recherche={recherche}
                clients={clients}
                groupes={groupes}
                onChoisi={() => {
                  setRecherche("");
                  setOuverte(false);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <Link
        to="/cabinet/notifications"
        aria-label={t("cab.top.notifications")}
        title={t("cab.top.notifications")}
        className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center border border-border bg-card hover:bg-accent"
      >
        <Bell size={16} strokeWidth={1.9} />
        {nonLues > 0 ? (
          <span className="num absolute -end-px -top-px min-w-[14px] bg-marigold px-0.5 text-center text-[9px] font-semibold leading-[14px] text-foreground">
            {nonLues}
          </span>
        ) : null}
      </Link>
      <button
        type="button"
        onClick={basculerPanneau}
        aria-label={t("cab.top.malica")}
        aria-pressed={panneauOuvert}
        title={t("cab.top.malica")}
        className={cn(
          "flex shrink-0 items-center justify-center border p-[3px]",
          panneauOuvert ? "border-foreground bg-card" : "border-border bg-card hover:bg-accent",
        )}
      >
        <MalicaAvatar size={26} alt="Malica" rond />
      </button>
    </div>
  );
}

/* --------------------------------------------------- le bandeau de dossier */

function BandeauDossier({
  clientId,
  clients,
  onChanger,
}: {
  clientId: string;
  clients: ClientSummary[];
  onChanger: (id: string) => void;
}) {
  const { t } = useI18n();
  const client = clients.find((c) => c.tenantId === clientId) ?? null;
  const classeOnglet =
    "whitespace-nowrap border-b-2 border-transparent py-2.5 text-[12.5px] text-muted-foreground hover:text-foreground [&.active]:border-foreground [&.active]:text-foreground";
  return (
    <div className="border-b border-foreground bg-sidebar">
      <div className="flex flex-wrap items-center gap-3.5 px-4 pt-3 sm:px-6 lg:px-9">
        <Link
          to="/cabinet/clients"
          aria-label={t("cab.dossier.back")}
          title={t("cab.dossier.back")}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center border border-border bg-card"
        >
          <ChevronLeft size={13} />
        </Link>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t("cab.dossier.kicker")}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <span className="text-[16px] font-semibold tracking-[-0.015em]">
              {client?.name ?? "…"}
            </span>
            {client?.legalId ? (
              <span className="num text-[10.5px] text-muted-foreground">{client.legalId}</span>
            ) : null}
          </p>
        </div>
        <span className="flex-1" />
        <label className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.dossier.change")}
          </span>
          <select
            value={clientId}
            onChange={(e) => onChanger(e.target.value)}
            aria-label={t("cab.dossier.change")}
            className="max-w-[240px] border border-border bg-card px-2.5 py-1.5 text-[12.5px]"
          >
            {clients.map((c) => (
              <option key={c.tenantId} value={c.tenantId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-4 overflow-x-auto px-4 sm:px-6 lg:px-9">
        <Link
          to="/cabinet/dossier/$clientId"
          params={{ clientId }}
          className={classeOnglet}
          activeOptions={{ exact: true }}
        >
          {t("cab.dossier.tab.synthese")}
        </Link>
        {ONGLETS_DU_DOSSIER.map((o) => (
          <Link key={o.to} to={o.to} className={classeOnglet}>
            {t(o.label)}
          </Link>
        ))}
      </div>
    </div>
  );
}
