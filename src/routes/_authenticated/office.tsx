import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Building2, Smartphone } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { LanguageSwitcher } from "@/components/regalica/LanguageSwitcher";
import { PackBanner } from "@/components/regalica/PackBanner";
import { useI18n } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/office")({
  head: () => ({
    meta: [
      { title: "Mon espace — Regalica Office" },
      {
        name: "description",
        content:
          "Vos organisations, établissements et référentiel fiscal en vigueur dans Regalica Office.",
      },
      { property: "og:title", content: "Mon espace — Regalica Office" },
      {
        property: "og:description",
        content: "Organisations, établissements et référentiel fiscal en vigueur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OfficeHome,
});

function OfficeHome() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const orgsQuery = useQuery({
    queryKey: ["my-organizations"],
    queryFn: () => office().identity.listMyOrganizations(),
  });

  const orgs = orgsQuery.data ?? [];
  const jurisdiction = orgs[0]?.jurisdiction ?? "TN";
  const pmeOrgs = orgs.filter((o) => o.kind === "pme");
  const cabinetOrgs = orgs.filter((o) => o.kind === "cabinet");

  const clientsQuery = useQuery({
    queryKey: ["cab-clients", cabinetOrgs[0]?.id],
    queryFn: () => office().supervision.listClients(cabinetOrgs[0]!.id),
    enabled: cabinetOrgs.length > 0,
  });

  // Un seul espace disponible : on y entre directement, sans écran intermédiaire.
  useEffect(() => {
    if (orgsQuery.isPending) return;
    if (pmeOrgs.length > 0 && cabinetOrgs.length === 0) void navigate({ to: "/pme" });
    if (cabinetOrgs.length > 0 && pmeOrgs.length === 0) void navigate({ to: "/cabinet" });
  }, [orgsQuery.isPending, pmeOrgs.length, cabinetOrgs.length, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="rule-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" className="text-sm font-semibold uppercase tracking-[0.18em]">
            {t("brand.name")}
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                await navigate({ to: "/auth" });
              }}
              className="border border-border px-3 py-2 text-xs uppercase tracking-wide transition-colors hover:bg-accent"
            >
              {t("app.signout")}
            </button>
          </div>
        </div>
      </header>

      <PackBanner jurisdiction={jurisdiction} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("pme.nav.office")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("portal.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("portal.subtitle")}
            </p>
          </section>

          <Link
            to="/onboarding"
            className="inline-flex items-center justify-center border border-foreground bg-foreground px-4 py-3 text-xs font-medium uppercase tracking-wide text-background transition-colors hover:bg-background hover:text-foreground lg:justify-self-end"
          >
            {t("app.orgs.create")}
          </Link>
        </div>

        {!orgsQuery.isPending && pmeOrgs.length === 0 && cabinetOrgs.length === 0 ? (
          <p className="mt-8 border border-border bg-card p-6 text-sm text-muted-foreground">
            {t("portal.norole")}
          </p>
        ) : (
          <section className="mt-8 grid gap-px border border-border bg-border md:grid-cols-2">
            {pmeOrgs.length > 0 ? (
              <AccessCard
                to="/pme"
                icon={<Smartphone className="h-5 w-5" aria-hidden />}
                title={t("landing.surfaces.pme.title")}
                body={t("landing.surfaces.pme.body")}
                cta={t("pme.nav.capture")}
                meta={`${t("portal.pme.count")} : ${pmeOrgs.length}`}
                tenants={pmeOrgs.map((o) => o.name)}
                primary
              />
            ) : null}
            {cabinetOrgs.length > 0 ? (
              <AccessCard
                to="/cabinet"
                icon={<Building2 className="h-5 w-5" aria-hidden />}
                title={t("landing.surfaces.cabinet.title")}
                body={t("landing.surfaces.cabinet.body")}
                cta={t("cab.brand")}
                meta={`${t("portal.cabinet.count")} : ${clientsQuery.data?.length ?? 0}`}
                tenants={cabinetOrgs.map((o) => o.name)}
              />
            ) : null}
          </section>
        )}

        {orgsQuery.isPending ? (
          <p className="mt-8 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : orgs.length === 0 ? (
          <p className="mt-8 border border-border bg-card p-6 text-sm text-muted-foreground">
            {t("app.orgs.empty")}
          </p>
        ) : (
          <div className="mt-8 grid gap-px border border-border bg-border lg:grid-cols-2">
            {orgs.map((org) => (
              <OrgCard key={org.id} org={org} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AccessCard({
  to,
  icon,
  title,
  body,
  cta,
  meta,
  tenants,
  primary,
}: {
  to: "/pme" | "/cabinet";
  icon: ReactNode;
  title: string;
  body: string;
  cta: string;
  meta?: string;
  tenants?: string[];
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-[180px] flex-col justify-between bg-card p-5 transition-colors hover:bg-accent sm:p-6"
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="grid h-10 w-10 place-items-center border border-border">{icon}</span>
          <span
            className={
              primary
                ? "border border-foreground bg-foreground px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-background"
                : "border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
            }
          >
            {cta}
          </span>
        </div>
        <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {meta ? (
        <div className="mt-5 border-t border-border pt-3">
          <p className="num text-[11px] uppercase tracking-wide text-muted-foreground">{meta}</p>
          {tenants && tenants.length > 0 ? (
            <p className="mt-1 truncate text-[12px] text-foreground">{tenants.join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}

function OrgCard({
  org,
}: {
  org: {
    id: string;
    name: string;
    kind: "pme" | "cabinet";
    legalId: string | null;
    jurisdiction: string;
    currency: string;
    validationMode: string;
    role: string;
  };
}) {
  const { t } = useI18n();
  const entities = useQuery({
    queryKey: ["entities", org.id],
    queryFn: () => office().identity.listEntities(org.id),
  });

  return (
    <article className="bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{org.name}</h2>
        <span className="border border-border px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
          {org.kind === "pme" ? t("app.kind.pme") : t("app.kind.cabinet")}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <Cell label={t("app.role")} value={org.role} />
        <Cell label={t("app.mode")} value={org.validationMode} />
        <Cell label={t("app.jurisdiction")} value={org.jurisdiction} />
        <Cell label={t("app.currency")} value={org.currency} />
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        {t("app.entities")}:{" "}
        <span className="num text-foreground">
          {entities.isPending
            ? "…"
            : (entities.data ?? []).map((e) => `${e.code} — ${e.name}`).join(" · ") || "—"}
        </span>
      </p>
    </article>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="num mt-1 text-foreground">{value}</dd>
    </div>
  );
}
