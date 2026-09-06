import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { CIBLE_COQUE } from "@/capabilities/coque";
import { LanguageSwitcher } from "@/components/regalica/LanguageSwitcher";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/")({
  // L'application Android est l'espace PME, et rien d'autre : la vitrine et
  // le cabinet restent sur le web. La coque s'ouvre directement sur le dossier.
  beforeLoad: () => {
    if (CIBLE_COQUE) throw redirect({ to: "/pme" });
  },
  head: () => ({
    meta: [
      { title: "Regalica Office — comptabilité augmentée, chiffre gouverné" },
      {
        name: "description",
        content:
          "Photographiez une facture : Regalica Office la lit avec citation de la zone source, en tire l'écriture, la TVA et l'échéance. Supervision par expert-comptable, Système Comptable Tunisien.",
      },
      { property: "og:title", content: "Regalica Office — comptabilité augmentée" },
      {
        property: "og:description",
        content:
          "Une photo, une écriture, une preuve. Moteur déterministe, citations obligatoires, supervision cabinet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useI18n();
  // Une seule porte : on se connecte, puis on choisit son espace. Le mode de
  // démonstration ouvrait un raccourci vers /office sans session — il montrait
  // une application qui n'était pas celle qui tourne.
  const workspaceRoute = "/auth";

  const pillars = [1, 2, 3, 4] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="rule-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em]">{t("brand.name")}</p>
            <p className="text-xs text-muted-foreground">{t("brand.tagline")}</p>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <Link
              to={workspaceRoute}
              className="border border-foreground bg-foreground px-4 py-2 text-xs font-medium uppercase tracking-wide text-background transition-colors hover:bg-background hover:text-foreground"
            >
              {t("nav.signin")}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 py-20">
          <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            {t("landing.hero.title")}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t("landing.hero.lede")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to={workspaceRoute}
              className="border border-foreground bg-foreground px-5 py-3 text-sm font-medium text-background transition-colors hover:bg-background hover:text-foreground"
            >
              {t("landing.hero.cta")}
            </Link>
            <a
              href="#doctrine"
              className="border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              {t("landing.hero.secondary")}
            </a>
          </div>
        </section>

        <section id="doctrine" className="rule-t">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("landing.pillars.title")}
            </h2>
            <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
              {pillars.map((n) => (
                <article key={n} className="bg-card p-6">
                  <p className="num text-xs text-muted-foreground">0{n}</p>
                  <h3 className="mt-3 text-lg font-medium">
                    {t(`landing.pillar.${n}.title` as const)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`landing.pillar.${n}.body` as const)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="rule-t">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("landing.surfaces.title")}
            </h2>
            <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
              <article className="bg-card p-6">
                <h3 className="text-lg font-medium">{t("landing.surfaces.pme.title")}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t("landing.surfaces.pme.body")}
                </p>
              </article>
              <article className="bg-card p-6">
                <h3 className="text-lg font-medium">{t("landing.surfaces.cabinet.title")}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t("landing.surfaces.cabinet.body")}
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="rule-t">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("landing.cycle.title")}
            </h2>
            <p className="num mt-6 text-sm leading-loose text-foreground">
              {t("landing.cycle.steps")}
            </p>
          </div>
        </section>
      </main>

      <footer className="rule-t">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <p className="text-xs text-muted-foreground">{t("landing.footer")}</p>
        </div>
      </footer>
    </div>
  );
}
