import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { usePanneauRegalica } from "@/components/regalica/panneau-regalica";
import { usePme } from "@/components/regalica/pme-context";
import { RegalicaChat } from "@/components/regalica/RegalicaChat";
import { MarqueRg, RegalicaAvatar } from "@/components/regalica/office-ui";
import { useAccueil, type MoisDeTva } from "@/hooks/use-accueil";
import { currentPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import { deMois, montant, montantSigne } from "@/lib/lisible";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pme/")({
  head: () => ({
    meta: [
      { title: "Mon espace — Regalica Office" },
      {
        name: "description",
        content: "Ce que Regalica a préparé : la TVA récupérée, le résultat, ce qui attend.",
      },
      { property: "og:title", content: "Mon espace — Regalica Office" },
      {
        property: "og:description",
        content: "Ce que Regalica a préparé : la TVA récupérée, le résultat, ce qui attend.",
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
 *   5. Regalica parle humain — plus un mot de vocabulaire comptable.
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
  const regalica = usePanneauRegalica("pme");
  const periode = currentPeriod();
  const a = useAccueil(periode);

  // Le bandeau « référentiel non ratifié » flottait au-dessus de tous les
  // écrans. Un avertissement partout n'avertit nulle part : il descend ici,
  // contre le chiffre qu'il qualifie, et disparaît dès que le pack est ratifié.
  const pack = useQuery({
    queryKey: ["ref-pack", pme.jurisdiction],
    queryFn: () => office().referential.activePack(pme.jurisdiction),
  });
  const indicatif = pack.data ? !pack.data.ratified : false;

  const mois = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );
  const moisCourant = mois(periode);
  // « Déclaration de août » n'est pas du français. Chaque clé reçoit les deux
  // formes ; chaque langue prend celle dont elle a besoin.
  const duMois = deMois(moisCourant, locale);

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
      {/* ------------------------------------------------ présence et salutation */}
      <header className="rg-rise relative overflow-hidden px-[22px] pb-4 pt-2">
        {/*
         * Le filigrane : 238 px à 2,5 % d'opacité, débordant en haut à droite.
         * C'est la marque devenue architecture — on ne la lit pas, on la sent.
         */}
        <MarqueRg
          aria-hidden
          className="pointer-events-none absolute -right-[84px] -top-[58px] h-[238px] w-[238px] opacity-[0.025]"
        />

        {/*
         * Une seule ligne en haut de l'écran, et le sigle la commande.
         *
         * Le sélecteur de dossier prend la place de « je veille » quand il y
         * a plusieurs dossiers : les deux ne tiennent pas côte à côte sous
         * 375 px, et une PME — qui n'en a qu'un — ne voit jamais le premier.
         */}
        <div className="relative flex items-center gap-[9px]">
          <MarqueRg aria-hidden className="h-[19px] w-[19px] flex-none" />
          <span className="rg-blink h-[5px] w-[5px] flex-none bg-marigold" />
          {pme.dossiers.length > 1 ? (
            <select
              aria-label={t("pme.org.switch")}
              value={pme.tenantId}
              onChange={(e) => pme.choisirDossier(e.target.value)}
              className="min-w-0 max-w-[110px] truncate border border-border bg-transparent px-1.5 py-1 text-[10px] uppercase tracking-wide focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {pme.dossiers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate text-[11px] text-muted-foreground">
              {t("pme.home.veille")}
            </span>
          )}
          <span className="ms-auto flex items-center gap-1.5">
            {pme.aUnCabinet ? (
              <Link
                to="/office"
                className="whitespace-nowrap border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-text-2 hover:bg-accent"
              >
                {t("portal.switch")}
              </Link>
            ) : null}
            <Link
              to="/pme/notifications"
              className="whitespace-nowrap border border-border px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-text-2 hover:bg-accent"
            >
              {locale.toUpperCase()} · ⚙
            </Link>
          </span>
        </div>

        <div className="relative mt-4 flex items-start gap-[14px]">
          {/*
           * Son visage ouvre le fil — le même geste qu'au cabinet. L'onde et la
           * clochette disent qu'elle a quelque chose à dire ; elles s'arrêtent
           * pour qui a demandé moins de mouvement.
           */}
          <button
            type="button"
            onClick={regalica.ouvert ? regalica.fermer : regalica.ouvrir}
            aria-label={
              regalica.ouvert ? t("regalica.panneau.fermer") : t("regalica.panneau.ouvrir")
            }
            className="relative grid h-[52px] w-[52px] flex-none place-items-center"
          >
            <span
              aria-hidden
              className="rg-wave absolute h-[52px] w-[52px] rounded-full border border-marigold"
            />
            <RegalicaAvatar size={52} alt="Regalica" rond />
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

        {indicatif ? (
          <p className="relative mt-3 border-s-2 border-marigold-on-ink ps-2.5 font-mono text-[10px] uppercase leading-[1.5] tracking-[0.08em] opacity-70">
            {t("pme.home.indicatif", {
              jurisdiction: pack.data!.jurisdiction,
              version: pack.data!.version,
            })}
          </p>
        ) : null}

        <p
          className={cn(
            "relative mt-3.5 text-[12px] font-medium",
            a.ecart === null
              ? "opacity-60"
              : Number(a.ecart) >= 0
                ? "text-signal-ok"
                : "text-signal-stop",
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
      <section className="flex min-h-0 flex-1 flex-col px-[22px] pt-5">
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
        <Ligne
          to="/pme/tva"
          label={
            a.aReverser === null || Number(a.aReverser) > 0
              ? t("pme.home.reverser", { mois: moisCourant })
              : t("pme.home.credit", { mois: moisCourant })
          }
          valeur={a.aReverser === null ? "—" : montant(a.aReverser.replace(/^-/, ""), locale)}
        />
        {/* La jauge n'existe que s'il y a quelque chose à jauger. */}
        <div className="relative h-[3px] bg-line-strong">
          {a.avancement === null ? null : (
            <i
              className="absolute inset-y-0 start-0 bg-marigold"
              style={{ width: `${Math.round(a.avancement * 100)}%` }}
            />
          )}
        </div>
        <p className="mt-[5px] text-end font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {a.avancement === null
            ? t("pme.home.prete.rien")
            : t("pme.home.prete", { pourcent: Math.round(a.avancement * 100) })}
        </p>

        <Ligne
          to="/pme/list"
          label={t("pme.home.documents", { deMois: duMois, mois: moisCourant })}
          valeur={String(a.documents)}
        />

        {a.retournees > 0 ? (
          <Ligne
            to="/pme/list"
            label={t("pme.home.attend", { count: a.retournees })}
            valeur="›"
            accent
          />
        ) : null}

        {/*
         * Deux cartes, et `mt-auto` les pousse au bas de l'écran : c'est ce
         * qui tient la page en UNE page. Échéances et alertes sont parties —
         * les alertes restent atteignables par l'engrenage du bandeau, les
         * échéances n'ont plus de porte sur cet écran.
         */}
        <div className="my-auto grid grid-cols-2 gap-3 py-4">
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
            onClick={regalica.ouvrir}
            className="flex min-h-[96px] flex-col justify-between gap-3.5 border border-border p-3.5 text-start hover:bg-accent"
          >
            <RegalicaAvatar size={26} alt="" rond />
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
       * Le fil de Regalica passe PAR-DESSUS.
       *
       * Il était une section de plus dans le flux : l'ouvrir allongeait la
       * page et forçait à faire défiler l'accueil, ce que la maquette
       * interdit. En panneau, il recouvre l'écran le temps de la question et
       * le rend intact — c'est l'écran « converser » de la maquette, appelé
       * depuis son visage.
       */}
      {regalica.ouvert ? (
        <div className="fixed inset-0 z-30 flex flex-col bg-background">
          <div className="flex items-center gap-3 border-b border-border px-[22px] py-3.5">
            <RegalicaAvatar size={34} alt="Regalica" rond />
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em]">
              {t("regalica.chat.her")}
            </p>
            <button
              type="button"
              onClick={regalica.fermer}
              aria-label={t("regalica.panneau.fermer")}
              className="ms-auto border border-border px-2.5 py-1 text-[15px] leading-tight text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-[22px] py-4">
            <RegalicaChat tenantId={pme.tenantId} />
          </div>
        </div>
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
        "flex w-full items-center justify-between gap-3 border-t border-border py-[15px] text-start hover:bg-secondary",
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
  label: string;
  sous: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[96px] flex-col justify-between gap-3.5 border border-border p-3.5 hover:bg-accent"
    >
      {children}
      <span>
        <span className="block text-[14.5px] font-medium">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-text-2">{sous}</span>
      </span>
    </Link>
  );
}
