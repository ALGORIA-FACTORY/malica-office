import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { MonEspaceParti } from "@/components/malica/mon-espace-parti";
import { useMonAcces } from "@/hooks/use-mon-acces";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

/**
 * Son Mon espace, hors des sociétés qu'il a quittées (lot 4) — atteint depuis
 * le compte (portail, réglages, écran sans société), indépendant de toute
 * société : il part avec le compte.
 *
 * Le dessin de Mon espace (`styles-pme.css`) vit sous `[data-surface="pme"]`
 * et sa colonne sous `.app` : les deux sont posés ici, sur deux éléments,
 * comme `pme.tsx` les pose (voir la raison là-bas). La teinte de l'espace
 * privé suit, par `.app:has([data-ecran="coffre"])`.
 */
export const Route = createFileRoute("/_authenticated/mon-espace")({
  head: () => ({ meta: [{ title: "Mon espace privé — Malica Office" }] }),
  component: EcranMonEspace,
});

function EcranMonEspace() {
  const { t } = useI18n();
  return (
    <div data-surface="pme">
      <div className="app flex flex-col text-foreground">
        <div className="top">
          <Link
            to="/office"
            className="bk"
            // DETTE nommée dans `pme.coffre.tsx` : le retour lit cette clé.
            aria-label={t("pme.regler.retour")}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M14.5 5.5L8 12l6.5 6.5" />
            </svg>
          </Link>
          <span className="ttl">{t("brand.name")}</span>
          <LanguageSwitcher />
        </div>
        <main className="flex min-h-0 flex-1 flex-col pb-6">
          <LienDeLaTour />
          <MonEspaceParti />
        </main>
      </div>
    </div>
  );
}

/**
 * La tour, aux seuls opérateurs d'ALGORIA (2 novembre 2026) : la même lecture
 * que le rail du cabinet (`mon_acces` → `app.is_platform()`), lue sur la
 * première organisation du compte — Mon espace n'en ouvre aucune.
 */
function LienDeLaTour() {
  const { t } = useI18n();
  const orgs = useQuery({
    queryKey: ["my-organizations"],
    queryFn: () => office().identity.listMyOrganizations(),
  });
  const acces = useMonAcces(orgs.data?.[0]?.id);
  if (!acces.data?.plateforme) return null;
  return (
    <Link to="/tour" data-lien-tour className="btn btn-sec mx-4 mt-3">
      {t("tour.titre")}
    </Link>
  );
}
