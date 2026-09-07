import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { coque, versionClient } from "@/capabilities/coque";
import { useApparence, type Apparence } from "@/components/regalica/apparence";
import { usePme } from "@/components/regalica/pme-context";
import { useI18n, LOCALES, LOCALE_NAMES } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { CANAL } from "@/lib/telemetrie";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";

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
        {t("fiche.titre")}
      </p>
      {/*
       * La porte vers la situation fiscale.
       *
       * Elle est ici et non sur l'accueil : l'accueil tient en une page, et ce
       * réglage se fait une fois puis se revisite rarement. Mais il commande la
       * moitié des réponses de Regalica — sans régime connu, elle ne peut ni
       * qualifier une opération ni répondre sur une déduction.
       */}
      <Link
        to="/pme/fiche"
        className="flex items-center justify-between gap-3 border-t border-foreground py-3.5"
      >
        <span>
          <span className="block text-[14.5px] font-medium">{t("fiche.champ.imposition")}</span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-text-2">
            {t("fiche.sous")}
          </span>
        </span>
        <span aria-hidden className="flex-none text-[17px] text-muted-foreground">
          ›
        </span>
      </Link>

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

      <p className="mb-1 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("pme.reglages.signaler")}
      </p>
      <Signalement />

      <p className="mb-1 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("pme.reglages.version")}
      </p>
      <Versions />

      <p className="mt-[22px] pb-6 text-[11.5px] text-muted-foreground">{t("pme.reglages.pied")}</p>
    </div>
  );
}

/*
 * Ce que l'appareil fait tourner.
 *
 * Trois nombres, parce qu'il y a trois choses : les ÉCRANS (le bundle web,
 * mis à jour en vol), l'APPLICATION (celle du magasin, qui porte les greffons
 * natifs), et le CANAL (staging, pilote, production — l'adresse de l'API et
 * la file des mises à jour). Pendant le test, c'est la première chose qu'on
 * demande à qui signale une anomalie ; autant qu'elle soit sous ses yeux.
 */
function Versions() {
  const { t } = useI18n();
  const [native, setNative] = useState<{ version: string; build: string } | null>(null);

  useEffect(() => {
    let vivant = true;
    void coque()
      .versions.native()
      .then((v) => {
        if (vivant) setNative(v);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, []);

  const ecrans = versionClient().split("/")[1] ?? "0.0.0";

  return (
    <p className="text-[11.5px] leading-[1.7] text-muted-foreground">
      {t("pme.reglages.version.ecrans")} <span className="text-foreground">{ecrans}</span>
      {native ? (
        <>
          {" · "}
          {t("pme.reglages.version.application")}{" "}
          <span className="text-foreground">
            {native.version} ({native.build})
          </span>
        </>
      ) : null}
      {" · "}
      {t("pme.reglages.version.canal")} <span className="text-foreground">{CANAL}</span>
    </p>
  );
}

/*
 * Signaler un problème.
 *
 * Ni de la télémétrie ni un journal : un geste. La phrase de la personne
 * arrive telle quelle, avec l'écran, l'appareil et la version — ce que le
 * pilote lit chaque semaine. Aucune pièce ne passe par là : pas d'image, pas
 * de montant, pas de texte relevé.
 */
function Signalement() {
  const { t } = useI18n();
  const pme = usePme();
  const [message, setMessage] = useState("");

  const envoi = useMutation({
    mutationFn: () =>
      office().signalements.deposer({
        tenantId: pme.tenantId,
        versionClient: versionClient(),
        appareil: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 300),
        ou: "/pme/reglages",
        message: message.trim(),
      }),
    onSuccess: () => setMessage(""),
  });

  const retour = envoi.isSuccess
    ? t("pme.reglages.signaler.merci")
    : envoi.isError
      ? texteDeLErreur(envoi.error, "routes/_authenticated/pme.reglages", t("common.error"))
      : "";

  return (
    <div className="border-t border-foreground pt-3">
      <p className="text-[12.5px] leading-[1.45] text-text-2">{t("pme.reglages.signaler.sous")}</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder={t("pme.reglages.signaler.champ")}
        aria-label={t("pme.reglages.signaler")}
        className="mt-2 w-full border border-line-strong bg-transparent px-3 py-2 text-[14px] leading-[1.45] placeholder:text-muted-foreground"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-muted-foreground" aria-live="polite">
          {retour}
        </span>
        <button
          type="button"
          disabled={message.trim() === "" || envoi.isPending}
          onClick={() => envoi.mutate()}
          className="border border-foreground bg-foreground px-4 py-2 text-xs uppercase tracking-wide text-background disabled:opacity-40"
        >
          {t("pme.reglages.signaler.envoyer")}
        </button>
      </div>
    </div>
  );
}
