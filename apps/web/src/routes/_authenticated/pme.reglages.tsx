import { createFileRoute, Link } from "@tanstack/react-router";

import { useApparence, type Apparence } from "@/components/regalica/apparence";
import { useI18n, LOCALES, LOCALE_NAMES } from "@/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pme/reglages")({
  head: () => ({
    meta: [
      { title: "Réglages — Regalica Office" },
      { name: "description", content: "Langue, apparence, et ce dont Regalica vous prévient." },
      { property: "og:title", content: "Réglages — Regalica Office" },
      {
        property: "og:description",
        content: "Langue, apparence, et ce dont Regalica vous prévient.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeReglages,
});

/**
 * Réglages — langue, apparence, alertes.
 *
 * ====================================================== CE QUI N'EST PAS LÀ
 *
 * Le prototype montre trois interrupteurs de notification : échéances,
 * bonnes nouvelles, heures calmes. Ils ne sont pas ici, et c'est délibéré.
 *
 * Une préférence de notification n'a de sens que si quelque chose la LIT au
 * moment d'envoyer. Rien n'envoie encore : les alertes se consultent dans
 * l'application, elles ne partent pas. Trois interrupteurs qui basculent
 * joliment sans rien changer promettraient « je préviens sept jours avant » —
 * une promesse que personne ne tient.
 *
 * Ils reviendront avec l'envoi, pas avant. En attendant, l'écran mène là où
 * les alertes existent vraiment.
 */
function PmeReglages() {
  const { t, locale, setLocale } = useI18n();
  const { apparence, choisir } = useApparence();

  const segment = "flex-1 border-0 px-3 py-[11px] text-[11.5px] font-semibold";

  const apparences: Array<{ cle: Apparence; label: string }> = [
    { cle: "systeme", label: t("pme.reglages.apparence.systeme") },
    { cle: "paper", label: t("pme.reglages.apparence.paper") },
    { cle: "ink", label: t("pme.reglages.apparence.ink") },
  ];

  return (
    <div className="rg-rise px-1 pt-2">
      <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
        {t("pme.reglages.titre")}
      </p>

      <p className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("pme.reglages.langue")}
      </p>
      <div className="flex border border-line-strong">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={l === locale}
            className={cn(
              segment,
              l === locale
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground",
            )}
          >
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>

      <p className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("pme.reglages.apparence")}
      </p>
      <div className="flex border border-line-strong">
        {apparences.map((a) => (
          <button
            key={a.cle}
            type="button"
            onClick={() => choisir(a.cle)}
            aria-pressed={a.cle === apparence}
            className={cn(
              segment,
              a.cle === apparence
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-[1.5] text-muted-foreground">
        {t("pme.reglages.apparence.note")}
      </p>

      <p className="mb-1 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("pme.reglages.alertes")}
      </p>
      {/*
       * Pas d'interrupteurs : rien n'envoie encore. On mène là où les alertes
       * existent réellement plutôt que de faire basculer trois boutons qui ne
       * changeraient rien.
       */}
      <Link
        to="/pme/notifications"
        className="flex items-center justify-between gap-3 border-t border-foreground py-3.5"
      >
        <span>
          <span className="block text-[14.5px] font-medium">{t("pme.nav.notifs")}</span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-text-2">
            {t("pme.reglages.alertes.sous")}
          </span>
        </span>
        <span aria-hidden className="flex-none text-[17px] text-muted-foreground">
          ›
        </span>
      </Link>
      <Link
        to="/pme/echeances"
        className="flex items-center justify-between gap-3 border-t border-border py-3.5"
      >
        <span>
          <span className="block text-[14.5px] font-medium">{t("pme.nav.echeances")}</span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-text-2">
            {t("pme.reglages.echeances.sous")}
          </span>
        </span>
        <span aria-hidden className="flex-none text-[17px] text-muted-foreground">
          ›
        </span>
      </Link>

      <p className="mt-[22px] pb-6 text-[11.5px] text-muted-foreground">{t("pme.reglages.pied")}</p>
    </div>
  );
}
