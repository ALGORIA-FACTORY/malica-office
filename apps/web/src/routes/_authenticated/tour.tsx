/**
 * La tour — l'espace commun des opérateurs d'ALGORIA (2 novembre 2026).
 *
 * Elle était une page du cabinet (19 octobre 2026) ; son ancienne adresse,
 * `/cabinet/tour`, a été retirée le 4 novembre 2026. Elle est un espace à elle, au-dessus des cabinets et des PME, avec son menu :
 * les CLIENTS (cabinets ; PME et leurs abonnements), la PLATEFORME, la
 * LECTURE. Le cap d'AGENTS.md le dit : « la tour de contrôle d'ALGORIA
 * Factory les voit toutes les deux ».
 *
 * La garde est celle de la base : `tour.suisJePlateforme` lit
 * `app.is_platform()`, la route RPC refuse tout dépôt `tour` à qui n'est pas
 * opérateur, et chaque lecture porte en plus le prédicat de plateforme. À un
 * autre compte, l'écran dit que la tour est réservée, et ne montre rien.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { COMMERCE } from "@/capabilities/coque";
import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { MarqueRg } from "@/components/malica/office-ui";
import { entreeActive, MENU, type EntreeDuMenu } from "@/components/malica/tour/sections";
import { FOCUS, Squelette } from "@/components/malica/tour/ui";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/tour")({
  // La tour est un poste de travail, et elle lit le commerce (abonnements,
  // factures) : pas dans l'application Android (`COMMERCE`). Une adresse
  // tapée dans la coque ramène au portail.
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/office" });
  },
  component: __COMMERCE__ ? LaTour : () => null,
});

function LaTour() {
  const { t } = useI18n();
  const plateforme = useQuery({
    queryKey: ["tour-suis-je"],
    queryFn: () => office().tour.suisJePlateforme(),
    retry: false,
  });
  if (plateforme.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Squelette lignes={4} />
      </main>
    );
  }
  if (!plateforme.data) {
    return (
      <main data-tour-reservee className="mx-auto max-w-xl px-4 py-16 text-center">
        <MarqueRg aria-hidden className="mx-auto h-8 w-8" />
        <h1 className="mt-6 text-[20px] font-semibold">{t("tour.titre")}</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">{t("tour.reserve")}</p>
        <Link
          to="/office"
          className={cn(
            "mt-8 inline-flex h-11 items-center border border-border px-4 text-[13px] hover:bg-accent",
            FOCUS,
          )}
        >
          {t("tour.quitter")}
        </Link>
      </main>
    );
  }
  return <Coquille />;
}

function Coquille() {
  const { t } = useI18n();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [tiroir, setTiroir] = useState(false);
  useEffect(() => setTiroir(false), [path]);
  // Le tiroir se ferme au bouton retour et à Échap ; le focus y entre et y boucle.
  const fermerTiroir = useCallback(() => setTiroir(false), []);
  const panneau = useRef<HTMLElement | null>(null);
  useSuperposition(tiroir, fermerTiroir, panneau);
  const actif = entreeActive(path);

  return (
    <div
      data-tour
      className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[240px_minmax(0,1fr)]"
    >
      <nav
        aria-label={t("tour.titre")}
        className="hidden border-e border-border bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col"
      >
        <Rail actif={actif?.entree ?? null} />
      </nav>
      {tiroir ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <nav
            ref={panneau}
            aria-label={t("tour.titre")}
            className="flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-e border-border bg-sidebar"
          >
            <Rail actif={actif?.entree ?? null} fermer={fermerTiroir} />
          </nav>
          <button
            type="button"
            aria-label={t("malica.panneau.fermer")}
            onClick={fermerTiroir}
            className="flex-1 bg-foreground/30"
          />
        </div>
      ) : null}

      <main className="min-w-0 lg:h-screen lg:overflow-y-auto">
        <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-9">
          <button
            type="button"
            onClick={() => setTiroir(true)}
            aria-label={t("cab.top.menu")}
            className={cn(
              "-ms-2 flex h-11 w-11 shrink-0 items-center justify-center lg:hidden",
              FOCUS,
            )}
          >
            <Menu size={18} aria-hidden />
          </button>
          <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{t("tour.titre")}</span>
            {actif ? (
              <>
                <span aria-hidden className="px-1.5 text-border">
                  /
                </span>
                {t(actif.entree.libelle)}
              </>
            ) : null}
          </p>
        </div>
        <div className="w-full px-4 py-6 sm:px-6 lg:px-9 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** Le menu : la marque, les trois groupes, la langue et la sortie. */
function Rail({ actif, fermer }: { actif: EntreeDuMenu | null; fermer?: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
        <MarqueRg aria-hidden className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">
            {t("tour.titre")}
          </span>
        </span>
        {fermer ? (
          <button
            type="button"
            onClick={fermer}
            aria-label={t("malica.panneau.fermer")}
            className={cn("-me-2 flex h-11 w-11 items-center justify-center", FOCUS)}
          >
            <X size={17} aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {MENU.map((g) => (
          <div key={g.cle} className="mb-5">
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t(g.libelle)}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.entrees.map((e) => {
                const estActif = actif?.cle === e.cle;
                const Icone = e.icone;
                const classe = cn(
                  "relative flex min-h-11 items-center gap-2.5 px-2.5 text-[13px]",
                  FOCUS,
                  estActif
                    ? "bg-accent font-medium text-foreground"
                    : "text-text-2 hover:bg-accent hover:text-foreground",
                );
                const contenu = (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 start-0 w-0.5",
                        estActif ? "bg-foreground" : "bg-transparent",
                      )}
                    />
                    <Icone size={16} strokeWidth={1.9} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t(e.libelle)}</span>
                  </>
                );
                return (
                  <li key={e.cle}>
                    {e.section ? (
                      <Link
                        to="/tour/$section"
                        params={{ section: e.section }}
                        aria-current={estActif ? "page" : undefined}
                        className={classe}
                      >
                        {contenu}
                      </Link>
                    ) : (
                      <Link
                        to={e.to}
                        aria-current={estActif ? "page" : undefined}
                        className={classe}
                      >
                        {contenu}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
        <LanguageSwitcher />
        <Link
          to="/office"
          className={cn(
            "flex min-h-11 items-center gap-2 border border-border bg-card px-2.5 text-[12.5px] hover:bg-accent",
            FOCUS,
          )}
        >
          <ArrowLeft size={14} aria-hidden className="rtl:rotate-180" />
          {t("tour.quitter")}
        </Link>
      </div>
    </>
  );
}
