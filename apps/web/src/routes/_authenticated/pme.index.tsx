import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { bienvenueDejaVue } from "@/components/malica/bienvenue";
import { EntetePme } from "@/components/malica/entete-pme";
import { PastilleAEnvoyer } from "@/components/malica/file-locale";
import { MandatsProposes } from "@/components/malica/MandatsProposes";
import { usePanneauMalica } from "@/components/malica/panneau-malica";
import { usePme } from "@/components/malica/pme-context";
import { MalicaChat } from "@/components/malica/MalicaChat";
import { MarqueRg, MalicaAvatar } from "@/components/malica/office-ui";
import { useAccueil, type MoisDeTva } from "@/hooks/use-accueil";
import { currentPeriod } from "@/hooks/use-tva";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useSuperposition } from "@/hooks/use-superposition";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import { montant, montantSigne } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { EcranPlein } from "@/components/EcranPlein";

export const Route = createFileRoute("/_authenticated/pme/")({
  head: () => ({
    meta: [
      { title: "Mon espace — Malica Office" },
      {
        name: "description",
        content: "Ce que Malica a préparé : la TVA récupérée, le résultat, ce qui attend.",
      },
      { property: "og:title", content: "Mon espace — Malica Office" },
      {
        property: "og:description",
        content: "Ce que Malica a préparé : la TVA récupérée, le résultat, ce qui attend.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeHome,
});

/**
 * L'accueil PME — d'après la maquette « Édition One II ».
 *
 * ====================================================== CE QUE LA MAQUETTE DIT
 *
 * Cinq déplacements, et ils tiennent tous à une idée : **le chiffre est le
 * sujet**. Pas six cartes de poids égal où la TVA du mois pèse autant qu'un
 * lien de réglages — un seul bloc d'encre à fond perdu, et le reste en
 * dessous.
 *
 *   1. Le sigle porte la page — filigrane de masthead, pas vignette posée.
 *   2. Le papier réglé remplace l'ombre : de la matière sans violer
 *      l'invariant « élévation par bordures ».
 *   3. Un seul bloc inversé : l'inversion EST la hiérarchie.
 *   4. Le mono devient la voix des chiffres, à l'échelle éditoriale.
 *   5. Malica parle humain — plus un mot de vocabulaire comptable.
 *
 * Le cinquième est le plus exigeant, et il a coûté des clés de traduction :
 * « 3 pièce(s) attendent votre confirmation » est devenu « il me manque trois
 * factures pour boucler avril ». Un dirigeant de PME ne dit pas « pièce ».
 *
 * ===================================================== CE QUI VIENT DU SOCLE
 *
 * Tous les chiffres, sans exception — `useAccueil` n'assemble que des entrées
 * et invoque les moteurs. Quand une donnée manque, l'écran écrit « — » ; il
 * n'écrit jamais « 0,000 », qui est un fait comptable et non une absence.
 */
function PmeHome() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const malica = usePanneauMalica("pme");
  useSuperposition(malica.ouvert, malica.fermer);
  const periode = currentPeriod();
  const a = useAccueil(periode);
  const navigate = useNavigate();

  /**
   * L'arrivée, une seule fois.
   *
   * Deux conditions, et il faut les deux : un dossier qui n'a jamais reçu de
   * pièce, ET une présentation jamais congédiée. Sans la seconde, « plus
   * tard » ramènerait ici et la présentation reviendrait au rechargement —
   * un écran dont on ne peut pas sortir.
   *
   * On attend que les pièces soient chargées : rediriger pendant le
   * chargement montrerait l'arrivée à un dossier qui en a déjà cent.
   */
  const dossierNeuf = !a.enCours && a.jamaisRienDepose;
  useEffect(() => {
    // `replace` : revenir depuis l'accueil de bienvenue ne doit pas retomber
    // sur l'accueil qui renvoie aussitôt à la bienvenue.
    if (dossierNeuf && !bienvenueDejaVue()) void navigate({ to: "/pme/bienvenue", replace: true });
  }, [dossierNeuf, navigate]);

  // Qui attend, exactement. « Votre comptable » est une périphrase : le
  // dirigeant connaît son cabinet par son nom, et c'est ce nom qui doit
  // apparaître quand quelque chose lui est retourné.
  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const mois = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );
  const moisCourant = mois(periode);
  // « Déclaration de août » n'est pas du français. Chaque clé reçoit les deux
  // formes ; chaque langue prend celle dont elle a besoin.

  const heure = new Date().getHours();
  const salut = t(
    heure < 12
      ? "pme.home.greet.morning"
      : heure < 18
        ? "pme.home.greet.afternoon"
        : "pme.home.greet.evening",
  );

  // Sa phrase. Elle dit ce qui manque, pas ce qui a été traité : c'est la
  // seule information sur laquelle le dirigeant peut agir ce matin.
  const restantes = a.avancement === null ? 0 : Math.round((1 - a.avancement) * 100) === 0 ? 0 : 1;
  const phrase =
    a.avancement === null
      ? t("pme.home.voix.rien")
      : restantes === 0
        ? t("pme.home.voix.enOrdre", { mois: moisCourant })
        : t("pme.home.voix.manque", { mois: moisCourant });

  return (
    <div className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col sm:-mx-6">
      {/* Un cabinet propose ? Le dirigeant répond avant tout le reste. */}
      <div className="pt-3">
        <MandatsProposes tenantId={pme.tenantId} />
        <PastilleAEnvoyer />
      </div>
      {/* ------------------------------------------------ présence et salutation */}
      <header className="rg-rise relative overflow-hidden px-[22px] pb-3 pt-2">
        {/*
         * Le filigrane : 238 px à 2,5 % d'opacité, débordant en haut à droite.
         * C'est la marque devenue architecture — on ne la lit pas, on la sent.
         */}
        <MarqueRg
          aria-hidden
          className="pointer-events-none absolute -right-[84px] -top-[58px] h-[238px] w-[238px] opacity-[0.025]"
        />

        <EntetePme
          dossiers={pme.dossiers}
          dossierActif={pme.tenantId}
          choisirDossier={pme.choisirDossier}
          aUnCabinet={pme.aUnCabinet}
        />

        <div className="relative mt-4 flex items-start gap-[14px]">
          {/*
           * Son visage ouvre le fil — le même geste qu'au cabinet. L'onde et la
           * clochette disent qu'elle a quelque chose à dire ; elles s'arrêtent
           * pour qui a demandé moins de mouvement.
           */}
          <button
            type="button"
            onClick={malica.ouvert ? malica.fermer : malica.ouvrir}
            aria-label={malica.ouvert ? t("malica.panneau.fermer") : t("malica.panneau.ouvrir")}
            className="relative grid h-[52px] w-[52px] flex-none place-items-center"
          >
            <span
              aria-hidden
              className="rg-wave absolute h-[52px] w-[52px] rounded-full border border-marigold"
            />
            <MalicaAvatar size={52} alt="Malica" rond />
            <span
              aria-hidden
              className="absolute -end-[7px] -bottom-[5px] grid h-[25px] w-[25px] place-items-center rounded-full border-2 border-background bg-marigold"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0A0A0A"
                strokeWidth="2.4"
                strokeLinecap="round"
                className="rg-bell"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            </span>
          </button>

          <div className="min-w-0">
            <p className="text-[27px] font-semibold leading-[1.05] tracking-[-0.03em]">{salut}</p>
            <p className="mt-[7px] text-[15px] leading-[1.5] text-text-2">{phrase}</p>
          </div>
        </div>
      </header>

      {/* ------------------------------------------- le bloc d'encre, à fond perdu */}
      <section className="rg-rise rg-regle relative overflow-hidden border-t-[3px] border-marigold-on-ink bg-foreground px-[22px] py-5 text-background">
        <p className="relative font-mono text-[10px] font-medium uppercase tracking-[0.2em] opacity-65">
          {t("pme.home.recuperee", { mois: moisCourant })}
        </p>
        <p className="relative mt-2.5 flex items-baseline gap-2">
          <span className="num text-[clamp(2.5rem,13vw,58px)] font-medium leading-[0.92] tracking-[-0.045em]">
            {a.recuperee === null ? "—" : montant(a.recuperee, locale)}
          </span>
          <span className="num text-[15px] font-medium opacity-60">{a.devise}</span>
        </p>

        <Trajectoire serie={a.serie} />

        <p
          className={cn(
            "relative mt-3.5 text-[12px] font-medium",
            a.ecart !== null && Number(a.ecart) < 0 ? "text-signal-stop" : "text-signal-ok",
          )}
        >
          {a.ecart === null
            ? t("pme.home.ecart.inconnu")
            : a.moisDeSuite >= 2
              ? t("pme.home.ecart.suite", {
                  ecart: montantSigne(a.ecart, locale),
                  mois: mois(a.serie[a.serie.length - 2]!.periode),
                  suite: a.moisDeSuite,
                })
              : t("pme.home.ecart.simple", {
                  ecart: montantSigne(a.ecart, locale),
                  mois: mois(a.serie[a.serie.length - 2]!.periode),
                })}
        </p>
      </section>

      {/* ------------------------------------------------ ce qu'elle a préparé */}
      <section className="flex min-h-0 flex-1 flex-col px-[22px] pt-3.5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-marigold">
          {t("pme.home.prepare")}
        </p>

        {/*
         * Le signe change le mot, pas seulement le chiffre.
         *
         * Un solde négatif n'est pas « à reverser » : c'est un crédit qui se
         * reporte sur le mois suivant. Afficher « TVA à reverser · −64,600 »
         * demanderait au dirigeant de faire la traduction lui-même — c'est
         * exactement le travail que ce produit lui retire.
         */}

        {/*
         * La troisième ligne existe toujours, et elle change de sujet.
         *
         * Quand le cabinet a retourné quelque chose, elle le dit — et elle le
         * dit à son nom. Sinon elle mène aux échéances, qui n'avaient plus
         * aucune porte depuis que la barre basse est passée à trois.
         */}
        {a.retournees > 0 ? (
          <Ligne
            to="/pme/regler"
            label={
              cabinet.data
                ? t("pme.home.attend.cabinet", {
                    cabinet: cabinet.data.name,
                    count: a.retournees,
                  })
                : t("pme.home.attend", { count: a.retournees })
            }
            valeur="›"
            accent
          />
        ) : (
          <Ligne to="/pme/echeances" label={t("pme.home.voirEcheances")} valeur="›" accent />
        )}

        {/*
         * Deux cartes, et `mt-auto` les pousse au bas de l'écran : c'est ce
         * qui tient la page en UNE page. Échéances et alertes sont parties —
         * les alertes restent atteignables par l'engrenage du bandeau, les
         * échéances n'ont plus de porte sur cet écran.
         */}
        <div className="my-auto grid grid-cols-2 gap-2.5 py-1">
          {/*
           * Le signe change le mot, pas seulement le chiffre.
           *
           * Un solde négatif n'est pas « à reverser » : c'est un crédit qui se
           * reporte sur le mois suivant. Afficher « TVA à reverser · −64,600 »
           * demanderait au dirigeant de faire la traduction lui-même — c'est
           * exactement le travail que ce produit lui retire.
           */}
          <Carte
            to="/pme/tva"
            label={
              a.aReverser === null || Number(a.aReverser) > 0
                ? t("pme.home.reverser")
                : t("pme.home.credit")
            }
            sous={
              a.avancement === null
                ? t("pme.home.prete.rien")
                : t("pme.home.prete", { pourcent: Math.round(a.avancement * 100) })
            }
          >
            {/*
             * Deux barres, deux couleurs — la même langue que « Vos charges ».
             *
             * Pas le chiffre : le montant est DÉJÀ le grand nombre du bloc
             * d'encre, deux doigts au-dessus. Pas la jauge non plus : elle
             * disait la même chose que « prête à 33 % », juste en dessous.
             *
             * Ce que les deux barres disent, c'est le rapport entre ce qui
             * entre et ce qui sort — la nature même d'un solde de TVA.
             */}
            <span className="flex h-[26px] w-full flex-col justify-end gap-[5px]">
              <i className="h-[6px] w-[72%] bg-foreground" />
              <i className="h-[6px] w-[44%] bg-marigold" />
            </span>
          </Carte>
          <Carte
            to="/pme/list"
            label={t("pme.home.documents.titre")}
            sous={t("pme.home.documents.sous")}
          >
            {/*
             * Le compte porte la couleur du produit. Ce n'est pas un ornement :
             * c'est le seul chiffre de la rangée basse, et la marigold le
             * désigne comme telle — la même encre que la jauge d'à côté.
             */}
            <span className="num block text-[24px] font-medium leading-none tracking-[-0.035em] text-marigold">
              {a.documents}
            </span>
          </Carte>
          <Carte
            to="/pme/charges"
            label={t("pme.home.card.charges")}
            sous={
              a.chargesEcart === null
                ? t("pme.home.charges.sous")
                : a.chargesEcart < 0
                  ? t("pme.home.charges.baisse", { pourcent: Math.abs(Math.round(a.chargesEcart)) })
                  : t("pme.home.charges.hausse", { pourcent: Math.round(a.chargesEcart) })
            }
          >
            <span className="flex h-[26px] items-end gap-1">
              <i className="h-full w-[5px] bg-foreground" />
              <i className="h-[64%] w-[5px] bg-line-strong" />
              <i className="h-[44%] w-[5px] bg-line-strong" />
              <i className="h-[30%] w-[5px] bg-marigold" />
            </span>
          </Carte>
          <button
            type="button"
            onClick={malica.ouvrir}
            className="flex min-h-[86px] flex-col justify-between gap-2.5 border border-border p-3 text-start hover:bg-accent"
          >
            <MalicaAvatar size={26} alt="" rond />
            <span>
              <span className="block text-[14.5px] font-medium">{t("pme.home.demander")}</span>
              <span className="mt-0.5 block text-[11.5px] text-text-2">
                {t("pme.home.demander.sous")}
              </span>
            </span>
          </button>
        </div>
      </section>

      {/*
       * Un échec de capture se dit là où on l'a provoqué, sans rien pousser :
       * il flotte au-dessus de la barre basse et disparaît au geste suivant.
       */}
      {pme.captureError ? (
        <p
          role="alert"
          className="fixed inset-x-3 bottom-[92px] z-20 border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12px]"
        >
          {pme.captureError}
        </p>
      ) : null}

      {/*
       * Le fil de Malica passe PAR-DESSUS.
       *
       * Il était une section de plus dans le flux : l'ouvrir allongeait la
       * page et forçait à faire défiler l'accueil, ce que la maquette
       * interdit. En panneau, il recouvre l'écran le temps de la question et
       * le rend intact — c'est l'écran « converser » de la maquette, appelé
       * depuis son visage.
       */}
      {malica.ouvert ? (
        <EcranPlein className="pt-safe fixed inset-0 z-30 mx-auto flex w-full max-w-md flex-col bg-background">
          <div className="flex items-center gap-3 border-b border-border px-[22px] py-3.5">
            <MalicaAvatar size={34} alt="Malica" rond />
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em]">
              {t("malica.chat.her")}
            </p>
            <button
              type="button"
              onClick={malica.fermer}
              aria-label={t("malica.panneau.fermer")}
              className="ms-auto border border-border px-2.5 py-1 text-[15px] leading-tight text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-[22px] py-4">
            <MalicaChat tenantId={pme.tenantId} />
          </div>
        </EcranPlein>
      ) : null}
    </div>
  );
}

/**
 * Douze mois de trajectoire, en douze barres.
 *
 * Un mois sans écriture ne rend PAS une barre à zéro — il rend un socle d'un
 * pixel. Zéro dinar récupéré et « je n'ai rien à dire sur ce mois » sont deux
 * faits différents, et les confondre sur une courbe est un mensonge muet.
 */
function Trajectoire({ serie }: { serie: readonly MoisDeTva[] }) {
  const valeurs = serie.map((m) => (m.recuperee === null ? null : Number(m.recuperee)));
  const haut = Math.max(...valeurs.filter((v): v is number => v !== null), 0);

  return (
    <div className="relative mt-[18px] flex h-[38px] items-end gap-[5px]">
      {serie.map((m, i) => {
        const v = valeurs[i];
        const dernier = i === serie.length - 1;
        if (v === null || v === undefined) {
          return <i key={m.periode} className="h-px flex-1 bg-current opacity-20" />;
        }
        const part = haut === 0 ? 0 : (v / haut) * 100;
        return (
          <i
            key={m.periode}
            className={cn("flex-1", dernier ? "bg-marigold-on-ink" : "bg-current opacity-[0.32]")}
            style={{ height: `${Math.max(part, 2)}%` }}
          />
        );
      })}
    </div>
  );
}

/** Une ligne de la liste : un nom à gauche, un fait à droite, un filet au-dessus. */
function Ligne({
  to,
  label,
  valeur,
  accent,
}: {
  to: string;
  label: string;
  valeur: string;
  accent?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex w-full items-center justify-between gap-3 border-t border-border py-[13px] text-start hover:bg-secondary",
        accent && "border-s-2 border-s-marigold ps-[11px]",
      )}
    >
      <span className="text-[15.5px] font-medium">{label}</span>
      <span className="num flex-none text-[15px] font-medium">{valeur}</span>
    </Link>
  );
}

/** Une carte carrée : un signe visuel en haut, le nom en bas. */
function Carte({
  to,
  label,
  sous,
  children,
}: {
  to: string;
  // Le mois s'écrit plus petit que le sujet : « Vos documents » porte la
  // carte, « de septembre » la précise. Un libellé balisé le permet.
  label: React.ReactNode;
  sous: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[86px] flex-col justify-between gap-2 border border-border p-3 hover:bg-accent"
    >
      {children}
      <span>
        <span className="block text-[13.5px] font-medium leading-[1.25]">{label}</span>
        <span className="mt-[3px] block text-[11px] text-text-2">{sous}</span>
      </span>
    </Link>
  );
}
