/**
 * Le choix d'un espace — la porte d'entrée après la connexion.
 *
 * Écran commun aux PME et aux cabinets : la personne y voit ses organisations (société ou
 * cabinet), leurs établissements et le référentiel fiscal en vigueur, et choisit où entrer.
 * Quand un seul espace existe, on y entre directement, sans passer par cet écran ; dans la
 * coque mobile, on va toujours à l'espace du dirigeant.
 *
 * Un client y voit deux choix, l'espace PME et l'espace comptabilité ; celui qu'il n'a pas
 * encore se crée depuis sa carte. La tour de contrôle n'est qu'une ligne discrète, et aux
 * seuls opérateurs de la plateforme : elle suit la même lecture que la tour elle-même
 * (`tour.suisJePlateforme`). Les données viennent de `identity.listMyOrganizations` et de
 * la supervision du cabinet.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Building2, Smartphone, TowerControl } from "lucide-react";

import { CIBLE_COQUE } from "@/capabilities/coque";
import { useEffect, type ReactNode } from "react";

import { InvitationsPourMoi } from "@/components/malica/InvitationsPourMoi";
import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { LienMonEspaceParti } from "@/components/malica/mon-espace-parti";
import { PackBanner } from "@/components/malica/PackBanner";
import { SeDeconnecter } from "@/components/malica/se-deconnecter";
import { useI18n } from "@/i18n";
import { compterLesMandatsActifs } from "@/lib/portefeuille-actif";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/office")({
  head: () => ({
    meta: [
      { title: "Choisir un espace — Malica Office" },
      {
        name: "description",
        content:
          "Vos organisations, établissements et référentiel fiscal en vigueur dans Malica Office.",
      },
      { property: "og:title", content: "Choisir un espace — Malica Office" },
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

  /*
   * La tour s'ouvre d'ici, et d'ici seulement (décision du dirigeant, 5
   * novembre 2026) : une ligne aux seuls opérateurs d'ALGORIA, la même lecture
   * que la tour elle-même (`tour.suisJePlateforme` → `app.is_platform()`).
   * Un opérateur n'est donc jamais renvoyé d'office vers son seul espace.
   */
  const plateforme = useQuery({
    queryKey: ["tour-suis-je"],
    queryFn: () => office().tour.suisJePlateforme(),
    retry: false,
  });
  const operateur = plateforme.data === true;

  // Les invitations adressées à la personne : un compte neuf qui en a une la lit ici.
  const invitations = useQuery({
    queryKey: ["invitations-pour-moi"],
    queryFn: () => office().collab.invitationsPourMoi(),
    retry: false,
  });

  // Un seul espace disponible : on y entre directement, sans écran intermédiaire.
  useEffect(() => {
    // Dans la coque, il n'y a qu'un espace : celui du dirigeant. Le cabinet
    // reste sur le web, quel que soit le compte.
    if (CIBLE_COQUE) {
      void navigate({ to: "/pme", replace: true });
      return;
    }
    if (orgsQuery.isPending || plateforme.isPending || operateur) return;
    /*
     * Un compte neuf, sans société ni invitation, entre directement dans la création de
     * sa société (le dirigeant, 22 novembre 2026 : « l'invitation de la comptabilité dès le
     * premier écran ») : c'est là que se donne l'e-mail de sa comptabilité. Celui qui a reçu
     * une invitation reste ici pour la lire.
     */
    /*
     * Pilote, 23 novembre 2026 : la société venait d'être créée, l'écran revenait à la
     * création. La liste en cache (vide) répondait avant la relecture ; un second envoi
     * se heurtait alors à « une seule société ». On ne renvoie à la création que sur
     * une liste relue, jamais sur une liste en cache en train de se relire.
     */
    if (orgsQuery.isFetching || invitations.isFetching) return;
    if (
      pmeOrgs.length === 0 &&
      cabinetOrgs.length === 0 &&
      invitations.isFetched &&
      (invitations.data ?? []).length === 0
    ) {
      void navigate({ to: "/onboarding", replace: true });
      return;
    }
    if (pmeOrgs.length > 0 && cabinetOrgs.length === 0) void navigate({ to: "/pme" });
    if (cabinetOrgs.length > 0 && pmeOrgs.length === 0) void navigate({ to: "/cabinet" });
  }, [
    orgsQuery.isPending,
    orgsQuery.isFetching,
    plateforme.isPending,
    operateur,
    pmeOrgs.length,
    cabinetOrgs.length,
    invitations.isFetched,
    invitations.isFetching,
    invitations.data,
    navigate,
  ]);

  return (
    <div className="bp-office min-h-screen bg-background text-foreground">
      <header className="rule-b">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" className="text-sm font-semibold uppercase tracking-[0.18em]">
            {t("brand.name")}
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <SeDeconnecter className="border border-border px-3 py-2 text-xs uppercase tracking-wide transition-colors hover:bg-accent" />
          </div>
        </div>
      </header>

      {/* L'état du référentiel est l'affaire des opérateurs : à une personne
          qui vient de s'inscrire, « Référentiel non ratifié » ne disait rien
          qu'elle puisse faire (recette du 11 novembre 2026, 4.1). */}
      {operateur ? <PackBanner jurisdiction={jurisdiction} /> : null}

      <main className="w-full px-4 py-8 sm:px-6 lg:py-12">
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

        <InvitationsPourMoi />

        {/* Son Mon espace des sociétés quittées : il part avec le compte (lot 4). */}
        <LienMonEspaceParti className="mt-6 inline-flex min-h-[48px] items-center border border-border px-4 text-sm font-medium" />

        {!orgsQuery.isPending && pmeOrgs.length === 0 && cabinetOrgs.length === 0 && !operateur ? (
          // Une seule phrase pour un compte neuf, qui dit quoi faire — le
          // portail en portait deux, et ne proposait rien (4.1).
          <div className="mt-8 border border-border bg-card p-6 text-sm">
            <p className="text-muted-foreground">{t("app.orgs.empty")}</p>
            <Link
              to="/onboarding"
              className="mt-4 inline-flex min-h-[44px] items-center border border-foreground bg-foreground px-4 text-xs font-medium uppercase tracking-wide text-background"
            >
              {t("app.orgs.create")}
            </Link>
          </div>
        ) : (
          <>
            {/*
             * Deux choix, toujours (décision du dirigeant, 24 novembre 2026) : l'espace PME et
             * l'espace comptabilité. Celui qui n'existe pas encore se crée depuis sa carte.
             */}
            <section className="bp-espaces mt-8 grid gap-px border border-border bg-border md:grid-cols-2">
              <AccessCard
                to={pmeOrgs.length > 0 ? "/pme" : "/onboarding"}
                icon={<Smartphone className="h-5 w-5" aria-hidden />}
                title={t("landing.surfaces.pme.title")}
                body={t("landing.surfaces.pme.body")}
                cta={pmeOrgs.length > 0 ? t("pme.nav.capture") : t("portal.pme.creer")}
                meta={
                  pmeOrgs.length > 0
                    ? `${t("portal.pme.count")} : ${pmeOrgs.length}`
                    : t("portal.pme.aucune")
                }
                tenants={pmeOrgs.map((o) => o.name)}
                primary={pmeOrgs.length > 0}
              />
              <AccessCard
                to={cabinetOrgs.length > 0 ? "/cabinet" : "/onboarding"}
                creerUnCabinet={cabinetOrgs.length === 0}
                icon={<Building2 className="h-5 w-5" aria-hidden />}
                title={t("landing.surfaces.cabinet.title")}
                body={t("landing.surfaces.cabinet.body")}
                cta={cabinetOrgs.length > 0 ? t("cab.brand") : t("portal.invitations.creer")}
                meta={
                  cabinetOrgs.length > 0
                    ? `${t("portal.cabinet.count")} : ${compterLesMandatsActifs(clientsQuery.data ?? [])}`
                    : t("portal.cabinet.aucun")
                }
                tenants={cabinetOrgs.map((o) => o.name)}
                primary={cabinetOrgs.length > 0 && pmeOrgs.length === 0}
              />
            </section>
            {/* La tour : une ligne discrète, aux seuls opérateurs de la plateforme. */}
            {operateur ? (
              <Link
                to="/tour"
                className="bp-tour mt-4 flex min-h-[48px] items-center gap-3 border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <TowerControl className="h-4 w-4 flex-none" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{t("tour.titre")}</span>
                  {" — "}
                  {t("portal.tour.body")}
                </span>
                <span className="num text-[11px] uppercase tracking-wide">
                  {t("portal.tour.cta")}
                </span>
              </Link>
            ) : null}
          </>
        )}

        {/* Le détail technique des organisations (rôle, mode de validation,
            juridiction, devise, établissements) est celui des opérateurs. */}
        {orgsQuery.isPending ? (
          <p className="mt-8 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : orgs.length === 0 || !operateur ? null : (
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
  creerUnCabinet,
  icon,
  title,
  body,
  cta,
  meta,
  tenants,
  primary,
}: {
  to: "/pme" | "/cabinet" | "/onboarding";
  /** Aucune comptabilité encore : la création s'ouvre sur « comptabilité ». */
  creerUnCabinet?: boolean;
  icon: ReactNode;
  title: string;
  body: string;
  cta: string;
  meta: string;
  tenants: string[];
  primary: boolean;
}) {
  return (
    <Link
      to={to}
      search={creerUnCabinet ? { nature: "cabinet" } : {}}
      // `min-w-0` : dans la grille, une carte prend sinon la largeur de sa plus
      // longue ligne. Recette du 7 novembre 2026 : avec 113 sociétés et des
      // dizaines de cabinets, la liste tronquée poussait la carte hors de
      // l'écran et cachait son bouton.
      className="bp-carte group flex min-h-[180px] min-w-0 flex-col justify-between bg-card p-5 transition-colors hover:bg-accent sm:p-6"
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
      <div className="mt-5 border-t border-border pt-3">
        <p className="num text-[11px] uppercase tracking-wide text-muted-foreground">{meta}</p>
        {tenants.length > 0 ? (
          <p className="mt-1 truncate text-[12px] text-foreground">{tenants.join(" · ")}</p>
        ) : null}
      </div>
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
