import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { usePme } from "@/components/malica/pme-context";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { useAccueil } from "@/hooks/use-accueil";
import { currentPeriod, useTvaPeriod } from "@/hooks/use-tva";
import { useMoisDeLExercice } from "@/hooks/use-mois-de-l-exercice";
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/tva")({
  head: () => ({
    meta: [
      { title: "Votre TVA — Malica Office" },
      {
        name: "description",
        content: "Ce que vous encaissez, ce que vous récupérez, ce que vous reversez.",
      },
      { property: "og:title", content: "Votre TVA — Malica Office" },
      {
        property: "og:description",
        content: "Ce que vous encaissez, ce que vous récupérez, ce que vous reversez.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeTva,
});

/**
 * Votre TVA — mois ou année, et une trajectoire.
 *
 * ======================================================= CE QUE LE MOIS DIT
 *
 * Trois lignes, et la troisième est en gras : encaissée sur vos ventes,
 * récupérable sur vos achats, ce que vous reversez. C'est la soustraction
 * qu'un dirigeant fait de tête et se trompe une fois sur deux — elle est
 * posée, dans cet ordre, avec le résultat détaché par un filet plein.
 *
 * Le vocabulaire n'est pas celui du plan comptable : « collectée » et
 * « déductible » sont des mots de comptable. « Ce que vous encaissez sur vos
 * ventes » est la même chose, dite à qui la paie.
 *
 * ====================================================== CE QUE L'ANNÉE DIT
 *
 * Douze mois de récupération, et leur somme. C'est la seule vue qui montre
 * qu'un mois creux n'est pas une tendance.
 *
 * Tous les chiffres viennent des moteurs : `computeTva` pour le mois,
 * `useAccueil` pour la série. Aucun n'est calculé ici.
 */
function PmeTva() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const [vue, setVue] = useState<"mois" | "annee">("mois");
  const periode = currentPeriod();

  const { tva, count, isPending } = useTvaPeriod(periode);

  // Les pièces parties sans date d'envoi : elles ne sont dans aucun mois, et
  // l'écran doit pouvoir le dire plutôt que de les laisser disparaître.
  const sansDate = useQuery({
    queryKey: ["transmises-sans-date", pme.tenantId],
    queryFn: () => office().office.transmisesSansDate(pme.tenantId),
    staleTime: 5 * 60 * 1000,
  });
  const annee = useAccueil(periode);

  const nomDuMois = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(`${periode}-01T00:00:00Z`),
  );

  const lisible = (v: string | null | undefined) =>
    v === null || v === undefined ? "—" : montant(v, locale);

  /*
   * ================================== LES DOUZE MOIS DE L'EXERCICE, PAS GLISSANTS
   *
   * La liste commençait au mois courant moins onze : « Nov, Déc, Jan … Oct »,
   * sans année, ce qui se lit comme une erreur tant qu'on n'a pas deviné qu'il
   * s'agit d'une fenêtre glissante. Un dossier se boucle par exercice, et le
   * commanditaire l'a tranché le 10 octobre : tous les mois paraissent, dès
   * janvier.
   *
   * `annee.serie` reste la fenêtre de CALCUL — elle traverse le changement
   * d'exercice, pour que janvier garde son comparatif. On ne fait que RANGER
   * ses valeurs dans les mois de l'exercice.
   */
  const moisDeLExercice = useMoisDeLExercice(periode);
  const valeurDuMois = new Map(annee.serie.map((m) => [m.periode, m]));
  const lignesDeLAnnee = moisDeLExercice.map((m) => ({
    ...m,
    recuperee: valeurDuMois.get(m.periode)?.recuperee ?? null,
  }));

  // Sur l'année : la somme des mois de récupération, mois vides exclus.
  const moisRenseignes = lignesDeLAnnee.filter((m) => m.recuperee !== null);
  const totalAnnuel = moisRenseignes.reduce((n, m) => n + Number(m.recuperee), 0);
  const haut = Math.max(...moisRenseignes.map((m) => Number(m.recuperee)), 0);

  const solde = tva?.totals.solde ?? null;
  const aReverser = solde !== null && Number(solde) > 0;

  const onglet = "flex-1 border-0 px-3 py-[7px] text-[11px] font-semibold";

  return (
    <div className="rg-rise -mx-4 flex min-h-0 flex-1 flex-col sm:-mx-6">
      <div className="flex items-baseline justify-between gap-3 px-[22px]">
        <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
          {t("pme.tva.titre")}
        </p>
        <span className="inline-flex border border-line-strong">
          <button
            type="button"
            onClick={() => setVue("mois")}
            className={cn(
              onglet,
              vue === "mois" ? "bg-foreground text-background" : "bg-transparent",
            )}
          >
            {t("pme.vue.mois")}
          </button>
          <button
            type="button"
            onClick={() => setVue("annee")}
            className={cn(
              onglet,
              vue === "annee" ? "bg-foreground text-background" : "bg-transparent",
            )}
          >
            {t("pme.vue.annee")}
          </button>
        </span>
      </div>

      {/* Le bloc d'encre : un seul chiffre, et ce qu'il veut dire. */}
      <section className="rg-regle relative mt-4 overflow-hidden bg-foreground px-[22px] py-5 text-background">
        <p className="relative font-mono text-[10px] font-medium uppercase tracking-[0.2em] opacity-65">
          {vue === "mois"
            ? aReverser
              ? t("pme.tva.kicker.reverser", { mois: nomDuMois })
              : t("pme.tva.kicker.credit", { mois: nomDuMois })
            : t("pme.tva.kicker.annee")}
        </p>
        <p className="relative mt-2.5 flex items-baseline gap-2">
          <span className="num text-[clamp(2.4rem,12.5vw,56px)] font-medium leading-[0.92] tracking-[-0.045em]">
            {vue === "mois"
              ? solde === null
                ? "—"
                : montant(solde.replace(/^-/, ""), locale)
              : moisRenseignes.length === 0
                ? "—"
                : montant(totalAnnuel.toFixed(3), locale)}
          </span>
          <span className="num text-[15px] font-medium opacity-60">
            {tva?.currency ?? pme.currency}
          </span>
        </p>
        <p className="relative mt-3 text-[12.5px] opacity-[0.72]">
          {vue === "mois"
            ? count === 0
              ? t("pme.tva.contexte.vide")
              : t("pme.tva.contexte.mois", { count })
            : t("pme.tva.contexte.annee", { count: moisRenseignes.length })}
        </p>
      </section>

      {vue === "mois" ? (
        <div className="px-[22px] pt-5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("pme.tva.solde.titre", { mois: nomDuMois })}
          </p>

          {isPending ? (
            <p className="pt-3 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : !tva ? (
            <p className="mt-3 border border-border bg-card p-4 text-[13.5px] text-text-2">
              {t("pme.tva.empty")}
            </p>
          ) : (
            <>
              <Ligne
                label={t("pme.tva.encaissee")}
                valeur={lisible(tva.totals.collectee)}
                filet="leger"
              />
              <Ligne
                label={t("pme.tva.recuperable")}
                valeur={lisible(tva.totals.deductible)}
                filet="leger"
              />
              {/*
               * Le filet plein détache le résultat de ses deux termes : c'est
               * la seule ligne de l'écran sur laquelle on agit.
               */}
              <Ligne
                label={aReverser ? t("pme.tva.reversez") : t("pme.tva.reporte")}
                valeur={solde === null ? "—" : montant(solde.replace(/^-/, ""), locale)}
                filet="plein"
              />
            </>
          )}

          {/* Ce qui manque encore, dit par elle — pas un avertissement système. */}
          {annee.avancement !== null && annee.avancement < 1 ? (
            <div className="mt-3.5 flex gap-3 border border-border bg-card p-3.5">
              <MalicaAvatar size={32} alt="Malica" rond />
              <p className="text-[14px] leading-[1.5]">
                {t("pme.tva.manque", {
                  pourcent: Math.round(annee.avancement * 100),
                  // En tête de phrase, un nom de mois prend la majuscule —
                  // « août est prêt » se lit comme une faute.
                  mois: nomDuMois.charAt(0).toUpperCase() + nomDuMois.slice(1),
                })}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="px-[22px] pt-5">
          {/*
           * L'exercice est NOMMÉ. Sans son année, « Nov, Déc, Jan … » se lit
           * comme une erreur de tri : c'est ce que montrait la capture du
           * 10 octobre.
           */}
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("pme.tva.douzeMois")} · {lignesDeLAnnee[0]?.periode.slice(0, 4)}
          </p>
          {lignesDeLAnnee.map((m) => {
            const v = m.recuperee === null ? null : Number(m.recuperee);
            const part = v === null || haut === 0 ? 0 : (v / haut) * 100;
            const nom = new Intl.DateTimeFormat(locale, {
              month: "short",
              timeZone: "UTC",
            }).format(new Date(`${m.periode}-01T00:00:00Z`));
            return (
              <div
                key={m.periode}
                className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border py-2.5"
              >
                <span
                  className={cn(
                    "num text-[12px] font-medium",
                    v === null ? "text-muted-foreground" : "",
                  )}
                >
                  {nom}
                </span>
                {/*
                 * Trois états, et ils ne se confondent pas :
                 *   un montant      → une barre ;
                 *   un mois PASSÉ sans écriture → un filet, et « — » ;
                 *   un mois À VENIR → rien, et le mot. Un mois qui n'a pas eu
                 *     lieu n'est pas un mois vide, et le montrer comme tel
                 *     ferait chercher une donnée perdue.
                 */}
                <span
                  className={cn(
                    "relative",
                    m.aVenir
                      ? "h-px bg-transparent"
                      : v === null
                        ? "h-px bg-border"
                        : "h-[6px] bg-line-strong",
                  )}
                >
                  {v === null ? null : (
                    <i
                      className="absolute inset-y-0 start-0 bg-foreground"
                      style={{ width: `${Math.max(part, 2)}%` }}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "num text-[13px] font-medium",
                    m.aVenir ? "text-[11px] font-normal text-muted-foreground" : "",
                  )}
                >
                  {m.aVenir
                    ? t("pme.tva.mois.aVenir")
                    : v === null
                      ? "—"
                      : montant(m.recuperee!, locale)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/*
       * ====================== L'ÉCRAN DIT QUELLE DATE IL EMPLOIE, ET IL LE DOIT
       *
       * Le 5 octobre, « Vos charges » affichait 222 000 et « Votre TVA » zéro
       * pour le même mois ; le 10, l'accueil disait 1 document et « Vos
       * documents » zéro. Chaque fois les deux écrans avaient raison dans
       * leur définition, et aucun ne disait laquelle.
       *
       * C'est cette mention — pas la règle — qui empêche deux chiffres de se
       * contredire en silence.
       */}
      <p className="px-[22px] pt-4 text-[11.5px] leading-[1.5] text-muted-foreground">
        {t("pme.tva.rangee")}
      </p>
      {sansDate.data ? (
        /*
         * Les pièces parties avant le 11 octobre n'ont pas de date d'envoi :
         * la transmission n'était alors qu'un drapeau. Elles ne pèsent dans
         * aucun mois — et une pièce qui disparaît des totaux sans que rien ne
         * la nomme est pire qu'une pièce mal rangée.
         */
        <p className="mt-2 border-s-[3px] border-signal-warn px-[22px] text-[12px] leading-[1.5] text-text-2">
          {t("pme.tva.sansDate", { count: sansDate.data })}
        </p>
      ) : null}
      <p className="px-[22px] pb-6 pt-3 text-[11.5px] leading-[1.5] text-muted-foreground">
        {t("pme.tva.source")}
      </p>
    </div>
  );
}

/** Une ligne du solde. Le filet plein marque le résultat, le léger ses termes. */
function Ligne({
  label,
  valeur,
  filet,
}: {
  label: string;
  valeur: string;
  filet: "leger" | "plein";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        filet === "plein" ? "border-t border-foreground py-3" : "border-t border-border py-[11px]",
      )}
    >
      <span
        className={cn(
          filet === "plein" ? "text-[13.5px] font-semibold" : "text-[13.5px] text-text-2",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "num",
          filet === "plein" ? "text-[17px] font-semibold" : "text-[14px] font-medium",
        )}
      >
        {valeur}
      </span>
    </div>
  );
}
