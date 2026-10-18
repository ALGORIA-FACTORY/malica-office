import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { usePme } from "@/components/malica/pme-context";
import { currentPeriod, useTvaPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
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

/* ===========================================================================
 *
 *   LES CHAÎNES NOUVELLES — UN SEUL BLOC, ET C'EST UNE DETTE NOMMÉE
 *
 * Même convention que `pme.regler` : le dessin apporte du texte que le
 * dictionnaire ne porte pas encore. Il est ici, en un seul endroit, en
 * français seulement, à vider dans `packages/socle/src/messages.ts` — clés
 * proposées `pme.tva.*` — dès que les trois langues peuvent être écrites
 * ensemble. Le dictionnaire vit dans `packages/socle`, où Claude Code écrit
 * en parallèle : on n'y touche pas depuis cette conversion.
 *
 * Tout ce qui EXISTE déjà au dictionnaire est lu par `t()` et n'est pas
 * réécrit — `pme.tva.collectee`, `pme.tva.deductible`, `pme.tva.rangee`,
 * `pme.tva.source`, `pme.tva.sansDate`, `pme.tva.empty`, `common.loading`.
 * Ces libellés sont déjà traduits en trois langues ; les recopier ici
 * aggraverait la dette au lieu de la nommer.
 */
const MOTS = {
  /** La barre du haut, et sa variante quand la licence porte plusieurs sociétés. */
  barre: "TVA du mois",
  barreGroupe: "TVA du groupe",
  retour: "Retour",
  /**
   * Le dessin écrit « Déclaration à déposer le 28. » — et le 28 est une
   * CONSTANTE RÉGLEMENTAIRE (R4). Aucune méthode appelée par cette route ne
   * sert l'échéance de dépôt : `parametrage.calendrierCabinet` et
   * `referentiel.fiscalCharges` existent au contrat mais ne sont pas câblés
   * ici, et les brancher serait recâbler. La phrase dit donc ce qui est vrai
   * sans la date — une échéance écrite en dur dans le TypeScript est une
   * faute que personne ne voit passer jusqu'au jour où elle change.
   */
  sous: "C'est votre cabinet qui dépose cette déclaration.",
  /** Variante Premium : le nombre vient de `pme.dossiers`, jamais d'un littéral. */
  sousGroupe: (n: number) => `${n} sociétés — chacune déclare pour elle-même.`,
  aPayer: "à payer",
  credit: "crédit reporté",
  /**
   * Le dessin écrit « En baisse de 31 % sur septembre ». C'est un POURCENTAGE
   * D'ÉVOLUTION entre deux mois : R3 interdit de le calculer ici, et aucune
   * méthode ne le sert. Le bloc reste — la comparaison est une vraie question
   * — et il dit qu'il ne l'a pas. Un « — » est honnête ; « 31 % » serait une
   * invention, et « en baisse » affirmerait un sens qu'on ignore.
   */
  tendance: "Comparaison avec le mois précédent : —",
  detail: "Le détail",
  parTaux: "par taux",
  collectee: "Collectée",
  deductible: "Déductible",
  /**
   * La ligne secondaire du dessin compte des factures par taux (« 11 factures
   * de vente »). `TvaBucket` porte `tax_code`, `rate`, `base` et `vat` — pas
   * de compte de pièces. On montre donc la BASE, que le moteur sert vraiment
   * et qui est la compagne naturelle d'une TVA, plutôt qu'un compte inventé.
   */
  base: "Base",
  /** Les lignes que le moteur a refusées, faute de taux gouverné à leur date. */
  nonRecuperable: "Non récupérable",
  refusees: (n: number) =>
    n === 1 ? "1 ligne sans taux gouverné à sa date" : `${n} lignes sans taux gouverné à leur date`,
  ceQuiChange: "Ce qui changerait le chiffre",
  sansDateMeta: "dans aucun mois",
  sansDateTitre: "Des pièces rangées dans aucun mois",
  parSociete: "Par société",
  /** Le solde par société n'est pas servi : le moteur tourne sur UN dossier. */
  soldeParSociete: "Solde non servi par société",
} as const;

/**
 * TVA du mois — le dessin validé (`livraison/ecrans/malica-manquants.html`,
 * écran « TVA »), porté sur la route qui portait déjà le calcul.
 *
 * ============================================== CE QUE CET ÉCRAN DIT, ET D'OÙ
 *
 * Un chiffre : le solde du mois, à payer ou reporté. Puis ses deux termes en
 * histogramme, puis le détail par taux, puis ce qui le ferait bouger.
 *
 * Tout vient de `useTvaPeriod`, qui assemble les extraits TRANSMIS du mois et
 * les taux gouvernés du pack, puis invoque `computeTva` du Socle. L'écran ne
 * calcule rien : il lit `totals`, `collectee[]`, `deductible[]` et
 * `refused[]` tels que le moteur les rend.
 *
 * ================================================= R3 — ELLE APPELLE, ELLE NE CALCULE PAS
 *
 * Trois calculs vivaient dans ce fichier, tous au service de la vue « année »
 * que le dessin ne porte pas :
 *
 *   — `totalAnnuel`, une somme des douze mois par `reduce` ;
 *   — `haut`, un `Math.max` sur la série ;
 *   — `part = (v / haut) * 100`, la largeur des barres de l'année.
 *
 * La vue « année » n'est pas dans le dessin — il n'y a ni `.seg` ni rangée de
 * douze mois dans le balisage rendu. Elle disparaît donc, et les trois
 * calculs avec elle. C'est la consigne tenue à la lettre : on ne les étend
 * pas, et ici on n'avait même pas à les porter.
 *
 * Reste `aReverser`, qui lit le SIGNE du solde rendu par le moteur
 * (`Number(solde) > 0`). Une comparaison n'est pas un calcul : rien n'est
 * dérivé, on lit de quel côté de zéro le Socle a posé son résultat. C'est ce
 * qui choisit `.chiffre.cr` et le libellé de l'unité.
 *
 * ========================================= R4 — AUCUNE CONSTANTE RÉGLEMENTAIRE
 *
 * Le « 19 % » du dessin n'est écrit NULLE PART dans ce fichier, pas même en
 * libellé. Chaque taux vient de `bucket.rate`, que `computeTva` recopie des
 * taux gouvernés du pack (`referentiel.taxRates`, lu par le hook). Le moteur
 * rend une fraction — « 0.1900 » — et `Intl` la REND en pourcentage : c'est
 * un formatage de locale, du même ordre que `montant()`, pas une
 * multiplication écrite ici.
 *
 * Même règle pour l'échéance de dépôt : voir `MOTS.sous`.
 *
 * =========================================== LE BLOC D'ENCRE, ET POURQUOI IL N'Y EST PLUS
 *
 * L'ancien balisage peignait le chiffre du mois en `bg-foreground
 * text-background` — encre sur papier. Sur les jetons sombres de la surface
 * PME, ce bloc s'inversait en DALLE BLANCHE, et il portait donc
 * `data-bloc="encre"` pour que la feuille le rattrape en `#141416`.
 *
 * Le dessin ne renverse plus rien : `.chiffre` (feuille, ligne 1433) ne pose
 * AUCUN fond, et le grand nombre s'écrit à même la page. Le marqueur n'est
 * donc pas reposé — et ce n'est pas un oubli : `#141416` sur un fond
 * `--bg: #0A0A0A` dessinerait une dalle plus claire que le dessin ne veut
 * pas. Le défaut est corrigé par la cause, pas par la béquille.
 *
 * ================================================= CE QUE LE DESSIN DEMANDE ET QU'ON NE SERT PAS
 *
 * Nommé, jamais comblé : l'échéance de dépôt, l'évolution sur le mois
 * précédent, le compte de factures par taux, le montant de TVA porté par les
 * pièces non transmises, et le solde par société. Chacun s'affiche « — » ou
 * se dit en mots, et aucun n'est inventé.
 */
function PmeTva() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  const periode = currentPeriod();

  const { tva, isPending } = useTvaPeriod(periode);

  // Les pièces parties sans date d'envoi : elles ne sont dans aucun mois, et
  // l'écran doit pouvoir le dire plutôt que de les laisser disparaître.
  // C'est le câblage que cette conversion devait conserver — il est intact.
  const sansDate = useQuery({
    queryKey: ["transmises-sans-date", pme.tenantId],
    queryFn: () => office().office.transmisesSansDate(pme.tenantId),
    staleTime: 5 * 60 * 1000,
  });

  /** « Octobre 2026 » — un formatage de locale, pas un calcul. */
  const moisEtAnnee = (() => {
    const rendu = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${periode}-01T00:00:00Z`));
    // En tête de titre, un nom de mois prend la majuscule.
    return rendu.charAt(0).toUpperCase() + rendu.slice(1);
  })();

  /**
   * Une fraction gouvernée, rendue en pourcentage par la locale. `Number()`
   * sert à FORMATER, jamais à arithmétiser : la valeur reste celle du pack.
   */
  const pourcent = (taux: string) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
      Number(taux),
    );

  const solde = tva?.totals.solde ?? null;
  const aReverser = solde !== null && Number(solde) > 0;

  /** Les deux sens du détail, dans l'ordre du dessin : collectée puis déductible. */
  const detail = [
    ...(tva?.collectee ?? []).map((b) => ({ sens: MOTS.collectee, seau: b })),
    ...(tva?.deductible ?? []).map((b) => ({ sens: MOTS.deductible, seau: b })),
  ];

  const refusees = tva?.refused ?? [];

  /**
   * L'axe Premium du dessin. La licence appartient à la personne, et
   * `ouvertures.societes` est décidé à UN SEUL endroit (`lib/forfait.ts`) :
   * on ne compare aucun nom d'offre ici. Les noms viennent de `pme.dossiers`,
   * que la coque a déjà lus ; le SOLDE par société, lui, n'est pas servi —
   * `computeTva` tourne sur un dossier à la fois, et une requête par société
   * contredirait « un écran, une fenêtre de données ».
   */
  const parSociete = pme.forfait.ouvertures.societes;

  return (
    /*
     * Les deux marqueurs. `data-famille="papiers"` fait descendre les 126
     * règles de la famille ; `data-ecran="tva"` est l'identité que l'audit
     * recense et que la règle d'en-tête unique interroge. Le dessin porte un
     * `.top` : cet écran fournit donc son propre en-tête, et celui du layout
     * s'efface tout seul par `.app:has([data-ecran] .top) > header`.
     *
     * `data-surface="pme"` est posé par le layout, sur un ancêtre. Jamais ici.
     */
    <div
      data-ecran="tva"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      {/* ── la barre du haut ───────────────────────────────────────────── */}
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={MOTS.retour}
          onClick={() => void navigate({ to: "/pme" })}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{parSociete ? MOTS.barreGroupe : MOTS.barre}</span>
        <span className="ic" aria-hidden>
          <IconeHistogramme />
        </span>
      </div>

      <div className="pad">
        <h1>{moisEtAnnee}</h1>
        <p className="sub">{parSociete ? MOTS.sousGroupe(pme.dossiers.length) : MOTS.sous}</p>

        {/*
         * LE CHIFFRE. `.cr` quand le solde est un crédit reporté : la feuille
         * le passe en `var(--acc)`. Le signe vient du moteur ; on le retire de
         * l'affichage parce que l'unité dit déjà le sens.
         */}
        <div className={aReverser ? "chiffre" : "chiffre cr"}>
          {solde === null ? "—" : montant(solde.replace(/^-/, ""), locale)}{" "}
          <u>
            {tva?.currency ?? pme.currency} {aReverser ? MOTS.aPayer : MOTS.credit}
          </u>
        </div>

        <div className="trd">
          <i aria-hidden />
          {MOTS.tendance}
        </div>

        {/*
         * La règle de rattachement, et c'est le cœur de l'écran : une pièce
         * compte dans le mois où elle est TRANSMISE. La phrase existe au
         * dictionnaire en trois langues — on la lit, on ne la réécrit pas.
         */}
        <p className="regle">
          <IconeInfo />
          <span>{t("pme.tva.rangee")}</span>
        </p>

        {isPending ? (
          <p className="regle">
            <span>{t("common.loading")}</span>
          </p>
        ) : !tva ? (
          <div className="card">
            <p>{t("pme.tva.empty")}</p>
          </div>
        ) : (
          <>
            {/*
             * ─────────────────────────────────── L'HISTOGRAMME, ET SA LARGEUR
             *
             * Les deux LIBELLÉS et les deux MONTANTS sont servis : ce sont
             * `totals.collectee` et `totals.deductible`, tels quels.
             *
             * La LARGEUR, elle, est une proportion entre ces deux montants, et
             * R3 interdit de la calculer en JavaScript. Elle n'est donc pas
             * calculée ici : les deux décimales gouvernées sont passées à la
             * feuille comme propriétés personnalisées, et c'est `calc()` — le
             * moteur de rendu — qui divise. Aucune arithmétique n'est écrite
             * dans ce composant, et aucun nombre dérivé n'est affiché : la
             * barre est un encodage visuel de deux valeurs citables.
             *
             * La collectée est la référence du dessin, à 100 % par
             * construction (le dessin l'écrit ainsi) : ce n'est pas un calcul,
             * c'est le haut de l'échelle. `min()` borne le dépassement si la
             * déductible excède la collectée, et la barre n'est posée que si la
             * référence est non nulle — une division par zéro ne rendrait rien.
             *
             * C'EST LE SEUL ARBITRAGE DE CETTE CONVERSION. Si la lecture de R3
             * doit être plus stricte, la barre déductible se retire en
             * supprimant le `<i className="d">` : les deux montants restent
             * lisibles dans `.l b`, et l'écran ne perd aucun chiffre.
             */}
            <div className="bars">
              <div>
                <span className="l">
                  <u>{t("pme.tva.collectee")}</u>
                  <b>{montant(tva.totals.collectee, locale)}</b>
                </span>
                <span className="b">
                  <i style={{ width: "100%" }} />
                </span>
              </div>
              <div>
                <span className="l">
                  <u>{t("pme.tva.deductible")}</u>
                  <b>{montant(tva.totals.deductible, locale)}</b>
                </span>
                <span className="b">
                  {Number(tva.totals.collectee) > 0 ? (
                    <i
                      className="d"
                      style={
                        {
                          "--col": tva.totals.collectee,
                          "--ded": tva.totals.deductible,
                          width: "min(100%, calc(var(--ded) / var(--col) * 100%))",
                        } as CSSProperties
                      }
                    />
                  ) : null}
                </span>
              </div>
            </div>

            {/* ── le détail, par taux ──────────────────────────────────── */}
            <div className="sec">
              <h2>{MOTS.detail}</h2>
              <span>{MOTS.parTaux}</span>
            </div>

            {/*
             * Une ligne par seau du moteur. Pas un `<button>` : aucun
             * détail par taux n'est servi, et un bouton qui ne mène nulle part
             * promet une pièce à voir qui n'existe pas. La feuille ne demande
             * pas `button` — `.rw` est agnostique de l'élément.
             */}
            {detail.map(({ sens, seau }) => (
              <div className="rw" key={`${sens}-${seau.tax_code}`}>
                <i aria-hidden>
                  <IconePiece />
                </i>
                <span className="bd">
                  <b>
                    {sens} {pourcent(seau.rate)}
                  </b>
                  <span>
                    {MOTS.base} {montant(seau.base, locale)}
                  </span>
                </span>
                <span className="rt">
                  <span className="vl">{montant(seau.vat, locale)}</span>
                </span>
              </div>
            ))}

            {/*
             * « Non récupérable » du dessin. `refused[]` rend une RAISON et un
             * `item_id` par ligne écartée — jamais un montant. Le compte est
             * donc vrai, et la valeur s'écrit « — » : afficher « 0,000 »
             * dirait que ces lignes ne portent pas de TVA, ce qu'on ne sait
             * pas. Les raisons sont des codes techniques
             * (`MISSING_TAX_RATE:…`) et ne sont pas montrées au dirigeant.
             */}
            {refusees.length > 0 ? (
              <div className="rw">
                <i aria-hidden>
                  <IconePiece />
                </i>
                <span className="bd">
                  <b>{MOTS.nonRecuperable}</b>
                  <span>{MOTS.refusees(refusees.length)}</span>
                </span>
                <span className="rt">
                  <span className="vl">—</span>
                </span>
              </div>
            ) : null}
          </>
        )}

        {/*
         * ── ce qui changerait le chiffre ────────────────────────────────
         *
         * Le dessin y met « 3 pièces lues, pas transmises » et chiffre le
         * contrefactuel (« vous payez 400,000 au lieu de 812,000 »). Ce
         * chiffre est une SOUSTRACTION sur des pièces que le moteur n'a pas
         * vues — il ne tourne que sur les extraits transmis — donc R3 l'exclut
         * et aucune méthode ne le sert.
         *
         * Ce que la route sert vraiment, et qu'elle servait déjà, c'est
         * `transmisesSansDate` : des pièces parties sans date d'envoi, qui ne
         * pèsent dans AUCUN mois. Elles changent bel et bien le chiffre, et la
         * phrase qui les explique est au dictionnaire, déjà traduite. La carte
         * dit donc ce fait-là, et le montant qu'elles portent s'écrit « — ».
         *
         * Les deux boutons du dessin — « Les transmettre », « Les voir » — ne
         * sont pas posés : aucun geste de transmission ni de filtre sur ces
         * pièces n'est au contrat depuis cet écran.
         */}
        {sansDate.data ? (
          <>
            <div className="sec">
              <h2>{MOTS.ceQuiChange}</h2>
              <span>{MOTS.sansDateMeta}</span>
            </div>
            <div className="card">
              <div className="hd">
                <b>{MOTS.sansDateTitre}</b>
                <span>—</span>
              </div>
              <p>{t("pme.tva.sansDate", { count: sansDate.data })}</p>
            </div>
          </>
        ) : null}

        {/*
         * ── l'axe par société, et lui seul ──────────────────────────────
         *
         * C'est le SEUL bloc que le diff `tva.solo` / `tva.premium` montre, en
         * plus du titre et du sous-titre. `basic`, `solo` et `team` sont
         * identiques : rien d'autre n'est conditionné.
         */}
        {parSociete ? (
          <>
            <div className="sec">
              <h2>{MOTS.parSociete}</h2>
              <span>{pme.dossiers.length}</span>
            </div>
            {pme.dossiers.map((d) => (
              <div className="rw" key={d.id}>
                <i aria-hidden>
                  <IconeHistogramme />
                </i>
                <span className="bd">
                  <b>{d.name}</b>
                  <span>{MOTS.soldeParSociete}</span>
                </span>
                <span className="rt">
                  <span className="vl">—</span>
                </span>
              </div>
            ))}
          </>
        ) : null}

        <p className="foot">{t("pme.tva.source")}</p>
      </div>
    </div>
  );
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de `malica-manquants.html`. Ils portent
 * `class="g"` — `stroke:currentColor`, `fill:none`, bouts arrondis. La taille
 * vient toujours du contexte (`.top .ic svg`, `.rw i svg`, `.regle svg`),
 * jamais de l'icône.
 */

/** L'histogramme — le signe de cet écran. */
function IconeHistogramme() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V7M17 16v-6" />
    </svg>
  );
}

/** Une pièce — la feuille au coin plié. */
function IconePiece() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6" />
    </svg>
  );
}

/** Le cercle d'information — il ouvre une règle, jamais une alerte. */
function IconeInfo() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.3" />
    </svg>
  );
}
