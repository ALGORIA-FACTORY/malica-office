import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { CabinetProvider } from "@/components/regalica/cabinet-context";
import { LanguageSwitcher } from "@/components/regalica/LanguageSwitcher";
import { PackBanner } from "@/components/regalica/PackBanner";
import { EmptyState, RegalicaPanel, RegalicaNote } from "@/components/regalica/office-ui";
import { RegalicaChat } from "@/components/regalica/RegalicaChat";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet")({
  head: () => ({
    meta: [
      { title: "Supervision cabinet — Regalica Office" },
      {
        name: "description",
        content:
          "File priorisée, écran côte-à-côte pièce et écriture, retour avec motif gouverné et contre-passation datée.",
      },
      { property: "og:title", content: "Supervision cabinet — Regalica Office" },
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

function CabinetLayout() {
  const { t } = useI18n();
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

  // Garde de rôle : sans appartenance cabinet, on renvoie au portail.
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

  const groups = [
    {
      key: "work",
      label: t("cab.nav.group.work"),
      items: [
        { to: "/cabinet", label: t("cab.nav.today"), exact: true },
        { to: "/cabinet/clients", label: t("cab.nav.clients"), exact: false },
        { to: "/cabinet/propositions", label: t("cab.nav.propositions"), exact: false },
        { to: "/cabinet/rapprochement", label: t("cab.nav.banque"), exact: false },
        { to: "/cabinet/echeances", label: t("cab.nav.echeances"), exact: false },
      ],
    },
    {
      key: "cabinet",
      label: t("cab.nav.group.cabinet"),
      items: [
        { to: "/cabinet/immobilisations", label: t("cab.nav.immo"), exact: false },
        { to: "/cabinet/stocks", label: t("cab.nav.stocks"), exact: false },
        { to: "/cabinet/affectation", label: t("cab.nav.affectation"), exact: false },
        { to: "/cabinet/statistiques", label: t("cab.nav.stats"), exact: false },
        { to: "/cabinet/pv", label: t("cab.nav.pv"), exact: false },
        { to: "/cabinet/plan", label: t("cab.nav.plan"), exact: false },
        { to: "/cabinet/reglages", label: t("cab.nav.settings"), exact: false },
      ],
    },
  ] as const;

  return (
    <CabinetProvider
      org={org}
      render={({ panel }) => (
        <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[264px_minmax(0,1fr)_300px]">
          {/* Navigation responsive : rail complet desktop, barre compacte en mobile/tablette. */}
          <nav
            aria-label={t("cab.brand")}
            className="sticky top-0 z-20 flex flex-col border-b border-border bg-background/95 backdrop-blur lg:h-screen lg:border-b-0 lg:border-e lg:sticky lg:top-0"
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 lg:block lg:px-6 lg:pb-4 lg:pt-6">
              <div className="min-w-0">
                <Link
                  to="/office"
                  className="block truncate text-[15px] font-semibold tracking-tight"
                >
                  {org.name}
                </Link>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {t("portal.current.cabinet")}
                </p>
              </div>
              {hasPme ? (
                <Link
                  to="/office"
                  className="shrink-0 border border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide hover:bg-accent lg:mt-3 lg:inline-block"
                >
                  {t("portal.switch")}
                </Link>
              ) : null}
            </div>

            <div className="flex gap-6 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:gap-0 lg:space-y-6 lg:overflow-y-auto lg:pb-4">
              {groups.map((group) => (
                <div key={group.key} className="shrink-0 lg:shrink">
                  <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground whitespace-nowrap">
                    {group.label}
                  </p>
                  <ul className="flex gap-1 lg:block">
                    {group.items.map((item) => {
                      const active = item.exact ? path === item.to : path.startsWith(item.to);
                      return (
                        <li key={item.to}>
                          <Link
                            to={item.to}
                            className={cn(
                              "block whitespace-nowrap px-3 py-2 text-[13px]",
                              active
                                ? "border-s-2 border-foreground bg-accent font-medium"
                                : "border-s-2 border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="hidden space-y-3 px-3 pb-5 lg:block">
              <PackBanner jurisdiction={org.jurisdiction} />
              <div className="flex items-center justify-between border border-border px-3 py-2">
                <span className="text-[12px] text-muted-foreground">{t("cab.search")}</span>
                <span className="num border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  ⌘K
                </span>
              </div>
              <LanguageSwitcher />
            </div>

            <div className="grid gap-2 border-t border-border px-3 py-3 sm:grid-cols-[1fr_auto] lg:hidden">
              <PackBanner jurisdiction={org.jurisdiction} />
              <LanguageSwitcher />
            </div>
          </nav>

          <main className="min-w-0 px-4 py-6 sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-10 lg:py-8">
            <Outlet />
            <section className="mt-8 border border-border bg-card lg:hidden">
              <RegalicaPanel
                title={t("cab.regalica.title")}
                status={t("cab.regalica.status")}
                footer={<RegalicaChat tenantId={org.id} />}
                framed={false}
              >
                {panel ?? <RegalicaNote>{t("cab.regalica.queue")}</RegalicaNote>}
              </RegalicaPanel>
            </section>
          </main>

          <div className="hidden lg:block lg:h-screen lg:overflow-y-auto">
            <RegalicaPanel
              title={t("cab.regalica.title")}
              status={t("cab.regalica.status")}
              footer={<RegalicaChat tenantId={org.id} />}
            >
              {panel ?? <RegalicaNote>{t("cab.regalica.queue")}</RegalicaNote>}
            </RegalicaPanel>
          </div>
        </div>
      )}
    />
  );
}
