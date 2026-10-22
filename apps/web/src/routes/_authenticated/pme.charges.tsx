import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import portraitMalica from "@/assets/malica.webp";
import { usePme } from "@/components/malica/pme-context";
import { useMoisDeLExercice } from "@/hooks/use-mois-de-l-exercice";
import { currentPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { nombre } from "@/lib/forfait";
import { deMois, montant, quantite } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import { computeChargesByFamille } from "@malica/socle/engines/charges/familles";

export const Route = createFileRoute("/_authenticated/pme/charges")({
  head: () => ({
    meta: [
      { title: "Mes charges par famille — Malica Office" },
      {
        name: "description",
        content:
          "Les charges de la période regroupées par famille, à partir d'articles cités, avec les écarts inhabituels signalés.",
      },
      { property: "og:title", content: "Mes charges par famille — Malica Office" },
      {
        property: "og:description",
        content:
          "Les charges de la période regroupées par famille, à partir d'articles cités, avec les écarts inhabituels signalés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChargesScreen,
});

const THRESHOLD_CODE = "FAMILLE_CONSO";

/**
 * « Vos charges » — le dessin validé (`livraison/ecrans/malica-charges.html`,
 * premier bloc `.app`, `data-scr="b-classes"`, et son détail `b-four`), porté
 * tel quel.
 *
 * ============================================================== CE QUI A CHANGÉ
 *
 * Le balisage, et lui seul. Le câblage est celui d'avant, appel pour appel :
 * `charges.familles`, `charges.articles`, `charges.anomalyThreshold`,
 * `referential.socleParams`, `charges.questions`, `charges.enAttenteDeDate`,
 * `charges.answer`, `useMoisDeLExercice`, et le moteur
 * `computeChargesByFamille` du Socle. Les mêmes données, une autre structure.
 *
 * Les QUESTIONS de Malica et leurs deux réponses restent le cœur de l'écran,
 * avec leurs gardes : la dernière réponse par question, et PAR QUI.
 *
 * ================================================ LE CSS EXISTE, ON NE L'ÉCRIT PAS
 *
 * `styles-pme.css` porte déjà toutes les règles du dessin sous
 * `[data-surface="pme"] [data-ecran="charges"]`. Cet écran pose donc
 * `data-ecran="charges"` sur sa racine et n'emploie QUE les classes relevées
 * dans cette feuille — `.pad .top .bk .ttl .per .lede .lbl .amt .trd .mta
 * .ceil .mths .sec .cls .hd .nm .pc .vl .bar .att .tot .note .bd .lines .ln
 * .qt .tag .locks .lock .foot .g`. Aucune classe utilitaire par-dessus : une
 * seule d'entre elles contredirait le dessin.
 *
 * `.app` du dessin n'est PAS rendu, comme sur l'accueil : la règle portée
 * `[data-ecran="charges"] .app{padding-top:4rem}` réservait la place de la
 * rangée de démonstration « Basic · Solo · Team · Premium », qui n'existe pas
 * dans l'application. Le cadre est tenu par le layout `pme.tsx`.
 *
 * `.nav` non plus : la barre du bas est rendue une fois par `pme.tsx`. La
 * redessiner ici en ferait deux.
 *
 * Les marges négatives de la racine annulent le `px-4 py-5` du layout :
 * `.top` et `.pad` portent les leurs, et le dessin ne veut pas de double
 * gouttière. C'est le seul endroit du fichier où une classe utilitaire
 * paraît, et elle ne touche aucun élément du dessin.
 *
 * ================================================= LA RANGÉE DES FORFAITS NE SE PORTE PAS
 *
 * Quatre blocs `.app` cohabitent dans le dessin — un par offre — avec un
 * sélecteur qui les permute. C'est une affordance de maquette. Ici, l'offre
 * se voit à deux endroits seulement : le plafond de lectures, et les cartes
 * `.lock` — visibles, jamais masquées, parce qu'un produit qui cache ce
 * qu'il vend ne le vend pas.
 *
 * ============================================ CE QUI N'EST PAS BRANCHÉ, ET POURQUOI
 *
 * **« Par siège » (Team) et « Par société » (Premium) ne sont pas rendus.**
 * `charges.articles` rend des articles cités : ni `created_by`, ni
 * `tenant_id`. Qui a engagé quoi, et quelle société a porté quoi, ne se
 * calcule donc pas sur les données chargées — et un graphique faux
 * désapprend. Les deux axes attendent leur donnée, pas un rendu. Quand
 * l'offre ne les ouvre pas, les cartes `.lock` disent ce qu'ils feraient ;
 * quand elle les ouvre, rien ne paraît : mieux vaut un axe absent qu'un axe
 * inventé, et aucun verrou n'est montré à qui a payé.
 *
 * **Le rapprochement intragroupe azure (`.cls.az`, `.note.az`) non plus.** Il
 * suppose le consolidé, qui suppose les sociétés.
 *
 * **Aucun appel n'est inventé.** Le dessin propose « Les classer » sur les
 * pièces sans classe et « À immobiliser ? » sur une ligne : ni l'un ni
 * l'autre n'a de méthode au contrat (`contrat/rpc.json`). Ils ne sont donc
 * pas dessinés. Le compteur de lectures, lui, vient de
 * `facturation.monForfait` — qui est au contrat, et que le layout lit DÉJÀ
 * une fois pour tous les écrans PME : rien n'est monté ici, et aucun
 * `creerDepotHttp` local n'a été nécessaire.
 *
 * **Valeur absente → « — », jamais « 0 ».** Le forfait non lu — chargement,
 * échec, licence absente — ne montre pas de plafond plutôt qu'un plafond à
 * zéro. Zéro est un fait comptable ; l'absence n'en est pas un.
 */
function ChargesScreen() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod());
  const [openFamille, setOpenFamille] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Les douze mois de l'exercice, de janvier à décembre. Une fenêtre de six
  // mois écrite ici ne correspondait à rien : un dossier se boucle par
  // exercice, et deux autres écrans en montraient douze et quatre.
  const periods = useMoisDeLExercice(period);

  const refs = useQuery({
    queryKey: ["charges-refs", pme.packId],
    enabled: !!pme.packId,
    queryFn: async () => {
      const packId = pme.packId!;
      const [familles, threshold, params] = await Promise.all([
        office().charges.familles(packId, locale),
        office().charges.anomalyThreshold(packId, THRESHOLD_CODE),
        office().referential.socleParams(packId),
      ]);
      return { familles, threshold, params };
    },
  });

  // L'exercice entier, du premier mois au dernier.
  //
  // L'ancienne fenêtre était rangée du plus RÉCENT au plus ancien, et la
  // requête prenait donc `periods[dernier]` comme borne basse. Les mois de
  // l'exercice vont dans l'autre sens : prendre la même case rendrait une
  // plage inversée, donc vide. Les bornes sont désormais nommées.
  const premierMois = periods[0]?.periode ?? period;
  const dernierMois = periods[periods.length - 1]?.periode ?? period;

  const articles = useQuery({
    queryKey: ["charges-articles", pme.tenantId, premierMois, dernierMois],
    queryFn: () => office().charges.articles(pme.tenantId, premierMois, dernierMois),
  });

  const questions = useQuery({
    queryKey: ["charge-questions", pme.tenantId],
    queryFn: () => office().charges.questions(pme.tenantId),
  });

  /*
   * Ce qui attend sa date n'entre dans aucun mois, depuis le 5 octobre 2026 :
   * une pièce dont la date n'a pas été lue n'est plus rangée au mois du scan.
   *
   * Il faut donc le dire ici. Retirer un montant d'un total sans le nommer
   * remplacerait un chiffre faux par un silence, et la personne chercherait
   * en vain pourquoi son total a baissé.
   */
  const sansDate = useQuery({
    queryKey: ["charges-sans-date", pme.tenantId],
    queryFn: () => office().charges.enAttenteDeDate(pme.tenantId),
  });

  const result = useMemo(() => {
    if (!refs.data || !articles.data) return null;
    // La base de comparaison : les mois de l'exercice ANTÉRIEURS au mois
    // regardé. Un mois à venir en est exclu de fait, et il doit l'être — une
    // moyenne calculée sur des mois qui n'ont pas eu lieu signalerait une
    // anomalie à chaque début d'exercice.
    const baseline = periods.filter((p) => p.periode < period).map((p) => p.periode);
    return computeChargesByFamille({
      articles: articles.data,
      familles: refs.data.familles,
      period,
      baselinePeriods: baseline,
      threshold: refs.data.threshold,
      decimals: refs.data.params.moneyDecimals,
    });
  }, [refs.data, articles.data, period, periods]);

  const answer = useMutation({
    mutationFn: async (input: { familleCode: string; reply: "exceptionnel" | "a_verifier" }) => {
      const anomaly = result?.anomalies.find((a) => a.familleCode === input.familleCode);
      if (!anomaly || !pme.packId) throw new Error(t("common.error"));
      return office().charges.answer({
        tenantId: pme.tenantId,
        period: anomaly.period,
        familleCode: anomaly.familleCode,
        observed: anomaly.observed,
        baseline: anomaly.baseline,
        deviationRatio: anomaly.deviationRatio,
        thresholdCode: anomaly.thresholdCode,
        packVersionId: pme.packId,
        answer: input.reply,
      });
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["charge-questions", pme.tenantId] });
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.charges", t("common.error"))),
  });

  /**
   * La derniere reponse par question, et PAR QUI.
   *
   * 11 octobre 2026 : « aussi la reponse du comptable aux questions envoyees
   * par Malica ». L'ecran disait « Repondu » sans dire qui — or
   * « exceptionnel » dit par l'expert est un avis professionnel, et dit par
   * le dirigeant une declaration. Ce n'est pas la meme phrase.
   *
   * La lecture rend les reponses de la plus recente a la plus ancienne : la
   * premiere rencontree est donc celle qui vaut.
   */
  const repondue = new Map<string, { par: "pme" | "cabinet" | null }>();
  for (const q of questions.data ?? []) {
    const cle = `${q.period}|${q.familleCode}`;
    if (q.answer !== null && !repondue.has(cle)) repondue.set(cle, { par: q.answeredSide });
  }

  const monthLabel = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );

  const moisLong = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );

  const pct = (v: string) => `${Number(v) >= 0 ? "+" : ""}${(Number(v) * 100).toFixed(0)} %`;

  /**
   * Une part du total, en pour-cent entier. L'espace reste insécable : en
   * français, un nombre ne se sépare pas de son signe en fin de ligne.
   *
   * Écrite en échappement U+00A0, et non collée telle quelle. Une espace insécable posée
   * dans un littéral est indiscernable d'une espace ordinaire à la relecture —
   * c'est exactement ce que `no-irregular-whitespace` refuse, et il le
   * refusait ici. Le rendu est identique au caractère près.
   */
  const part = (v: string) => `${Math.round(Number(v) * 100)}\u00a0%`;

  if (refs.isPending || articles.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  const familles = result?.familles ?? [];
  const maxTotal = Math.max(...familles.map((f) => Number(f.total)), 0);
  /* Le total du mois, ou son absence. Écrit une fois, lu deux fois. */
  const totalLisible = result ? montant(result.total, locale) : "—";
  const evolutionValue = result?.evolution ?? null;
  const evolution = evolutionValue === null ? null : Number(evolutionValue);

  /*
   * La classe « fourre-tout » du pack — « Non classée ». C'est elle qui porte
   * l'ambre du dessin (`.cls.att`), et non une couleur choisie à la main : le
   * pack dit laquelle est le repli (`isFallback`), le TypeScript n'en décide
   * rien.
   */
  const codeFourreTout = (refs.data?.familles ?? []).find((f) => f.isFallback)?.code ?? null;

  /** Une question sans réponse attend, elle aussi : le dessin n'a qu'une couleur pour cela. */
  const attend = (code: string) =>
    code === codeFourreTout ||
    (result?.anomalies ?? []).some(
      (a) => a.familleCode === code && !repondue.has(`${a.period}|${a.familleCode}`),
    );

  /** Les lignes du mois : la seule fenêtre de données de cet écran, filtrée. */
  const lignesDuMois = (articles.data ?? []).filter((a) => a.period === period);
  const piecesDuMois = new Set(lignesDuMois.map((a) => a.pieceId)).size;

  /*
   * ====================================================== LE PLAFOND DE LECTURES
   *
   * Les deux bornes, ou rien. Le dessin le montre sous le total parce que
   * c'est là qu'il porte : au-delà du plafond, le total affiché juste
   * au-dessus est incomplet, et c'est la seule chose qui l'explique.
   *
   * Aucun seuil n'est inventé : il ne paraît pas « quand il reste peu », il
   * paraît quand le compteur est LU. Décider à partir de quel reste il doit
   * se taire est une décision de produit, pas une liberté d'écran.
   */
  const lecturesRestantes = nombre(pme.forfait.ligne?.lectures_restantes);
  const lecturesDroit = nombre(pme.forfait.ligne?.lectures_droit);
  const plafondLisible = lecturesRestantes !== null && lecturesDroit !== null && lecturesDroit > 0;

  /*
   * ================================================== LA CLASSE OUVERTE, ET SON ÉCRAN
   *
   * Le dessin ouvre une classe sur un écran À ELLE — titre, mois, lignes,
   * total — et la flèche referme. Pas de route nouvelle : un état, et deux
   * balisages. `ouverte` peut rester `null` alors qu'une classe est demandée
   * (la classe n'a rien ce mois-ci) : l'écran le dit avec « — » et la liste
   * vide, plutôt que de ramener en arrière sans explication.
   */
  const ouverte = familles.find((f) => f.code === openFamille) ?? null;
  const libelleOuverte =
    ouverte?.label ??
    (refs.data?.familles ?? []).find((f) => f.code === openFamille)?.label ??
    openFamille ??
    "";
  const lignesOuvertes = lignesDuMois.filter((a) => a.familleCode === openFamille);

  /** Le classeur des mois — commun aux deux écrans. */
  const classeurDesMois = (
    <div className="mths" role="group" aria-label={t("pme.charges.period")}>
      {periods.map((p) => (
        <button
          key={p.periode}
          type="button"
          className={p.periode === period ? "on" : undefined}
          onClick={() => setPeriod(p.periode)}
          disabled={p.aVenir}
          aria-pressed={p.periode === period}
        >
          {monthLabel(p.periode)}
        </button>
      ))}
    </div>
  );

  /* ─────────────────────────────── l'écran d'une classe ─────────────────── */
  if (openFamille !== null) {
    return (
      <div data-ecran="charges" className="-mx-4 -my-5">
        <div className="top">
          <button
            type="button"
            className="bk"
            aria-label={t("pme.regler.retour")}
            onClick={() => setOpenFamille(null)}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M14.5 5.5L8 12l6.5 6.5" />
            </svg>
          </button>
          <span className="ttl">{libelleOuverte}</span>
          <span className="per">{monthLabel(period)}</span>
        </div>

        <div className="pad">
          <div className="lede">
            <div className="lbl">
              {libelleOuverte} · {moisLong(period)}
            </div>
            <div className="amt">
              {ouverte ? montant(ouverte.total, locale) : "—"} <u>{pme.currency}</u>
            </div>
            {/*
             * Le dessin porte ici un `.trd` — « En baisse de 18 % sur
             * janvier ». Il n'est pas rendu : le moteur du Socle rend
             * l'évolution du TOTAL, pas celle d'une classe, et la calculer
             * dans l'écran ferait de lui la deuxième autorité sur une
             * comparaison. Elle viendra du moteur ou pas du tout.
             */}
            <div className="mta">
              {ouverte
                ? t("pme.charges.partDesCharges", {
                    count: new Set(lignesOuvertes.map((a) => a.pieceId)).size,
                    part: part(ouverte.share),
                  })
                : t("pme.charges.empty")}
            </div>
          </div>

          {classeurDesMois}

          <div className="sec">
            <h2>{t("pme.charges.lesPieces")}</h2>
            <span>{t("pme.detail.compte", { count: lignesOuvertes.length })}</span>
          </div>

          {lignesOuvertes.length > 0 ? (
            <div className="lines">
              {lignesOuvertes.map((a) => (
                <Link
                  key={`${a.pieceId}-${a.ordinal}`}
                  to="/pme/piece/$pieceId"
                  params={{ pieceId: a.pieceId }}
                  className="ln"
                >
                  <span className="hd">
                    <span className="nm">{a.designation}</span>
                    {/*
                     * Un montant NON CITÉ ne s'écrit pas : le moteur le
                     * compte pour zéro faute de mieux, l'écran ne le
                     * présente pas comme un prix lu.
                     */}
                    <span className="vl">
                      {a.citationTotalHt && a.totalHt ? montant(a.totalHt, locale) : "—"}
                    </span>
                  </span>
                  <span className="qt">
                    {t("pme.detail.qte", {
                      q: a.citationQuantity && a.quantity ? quantite(a.quantity, locale) : "—",
                    })}
                    {a.citationUnitPriceHt && a.unitPriceHt
                      ? " · " + t("pme.detail.pu", { pu: montant(a.unitPriceHt, locale) })
                      : ""}
                  </span>
                  {/*
                   * Le dessin pose ici deux marques de plus : `.tag`
                   * (« À immobiliser ? Je vous demande ») et `.who`
                   * (« Saisie Sami · 12 févr. »). Aucune des deux n'a de
                   * donnée : pas de question au niveau de la ligne au
                   * contrat, et `charges.articles` ne rend pas qui a saisi.
                   */}
                </Link>
              ))}
            </div>
          ) : (
            <p className="foot">{t("pme.charges.empty")}</p>
          )}

          {ouverte ? (
            <div className="tot">
              <b>{t("pme.charges.totalDe", { famille: libelleOuverte })}</b>
              <span>{montant(ouverte.total, locale)}</span>
              <u>{pme.currency}</u>
            </div>
          ) : null}

          <p className="foot">{t("pme.charges.disclaimer")}</p>
        </div>
      </div>
    );
  }

  /* ──────────────────────────── l'écran des classes ─────────────────────── */
  return (
    /*
     * `data-ecran="charges"` : le marqueur qui fait descendre sur cet arbre
     * les 82 règles du dessin.
     */
    <div data-ecran="charges" className="-mx-4 -my-5">
      <div className="top">
        <Link to="/pme" className="bk" aria-label={t("pme.regler.retour")}>
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </Link>
        <span className="ttl">{t("pme.charges.title")}</span>
        <span className="per">{monthLabel(period)}</span>
      </div>

      <div className="pad">
        {/* ── le chiffre ─────────────────────────────────────────────────── */}
        <div className="lede">
          <div className="lbl">{t("pme.charges.total")}</div>
          <div className="amt">
            {totalLisible} <u>{pme.currency}</u>
          </div>

          {/*
           * La tendance en un mot. Le dessin ne porte qu'UNE couleur pour
           * `.trd` — l'Evergreen — et une hausse n'y a pas de variante : la
           * pastille reste donc verte même quand la phrase dit « En hausse ».
           * Rien n'est ajouté par-dessus la feuille pour corriger cela ;
           * c'est au dessin de trancher, pas à l'écran.
           */}
          {evolution !== null ? (
            <div className="trd">
              <i />
              {evolution < 0
                ? t("pme.charges.trend.down", { value: pct(evolutionValue!) })
                : t("pme.charges.trend.up", { value: pct(evolutionValue!) })}
            </div>
          ) : null}

          <div className="mta">{`${t("pme.doc.compte", { count: piecesDuMois })} · ${t("pme.charges.nbClasses", { count: familles.length })}`}</div>
        </div>

        {/* ── le plafond de lectures ─────────────────────────────────────── */}
        {plafondLisible ? (
          <div className="ceil">
            <i />
            <p>
              {t("pme.charges.plafond", {
                count: lecturesRestantes,
                droit: lecturesDroit,
                mois: deMois(
                  new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
                    new Date(`${period}-01T00:00:00Z`),
                  ),
                  locale,
                ),
              })}
            </p>
          </div>
        ) : null}

        {classeurDesMois}

        {/* ── par classe ─────────────────────────────────────────────────── */}
        <div className="sec">
          <h2>{t("pme.charges.byFamille")}</h2>
          <span>{t("pme.charges.classes", { count: familles.length })}</span>
        </div>

        {familles.length > 0 ? (
          <>
            {familles.map((f) => {
              const largeur = maxTotal > 0 ? (Number(f.total) / maxTotal) * 100 : 0;
              return (
                <button
                  key={f.code}
                  type="button"
                  className={attend(f.code) ? "cls att" : "cls"}
                  onClick={() => setOpenFamille(f.code)}
                >
                  <span className="hd">
                    <span className="nm">{f.label}</span>
                    <span className="pc">{part(f.share)}</span>
                    <span className="vl">{montant(f.total, locale)}</span>
                  </span>
                  <span className="bar">
                    <i style={{ width: `${largeur}%` }} />
                  </span>
                </button>
              );
            })}

            <div className="tot">
              <b>{t("pme.charges.total")}</b>
              <span>{totalLisible}</span>
              <u>{pme.currency}</u>
            </div>
          </>
        ) : (
          <p className="foot">{t("pme.charges.empty")}</p>
        )}

        {/*
         * ──────────────────────────────── les questions de Malica ─────────
         *
         * Elle interroge, elle ne tranche pas. Les deux réponses ont le même
         * poids visuel : aucune n'est présentée comme la bonne, parce
         * qu'aucune ne l'est — seul le dirigeant sait s'il a fait un achat
         * exceptionnel.
         *
         * Le dessin ne met qu'UN bouton dans `.note .bd`. Deux y entrent, et
         * c'est délibéré : l'égalité des deux réponses est une règle de
         * produit écrite avant le dessin, et la réduire à un bouton unique
         * ferait de l'écran un conseil déguisé. Les deux portent donc la même
         * pastille accent.
         */}
        {(result?.anomalies ?? []).map((a) => {
          const faite = repondue.get(`${a.period}|${a.familleCode}`) ?? null;
          return (
            <div key={a.familleCode} className="note">
              <img src={portraitMalica} alt="Malica" width={620} height={620} />
              {/*
               * `.bd` est un `div` et non le `span` du dessin : il contient un
               * paragraphe, et un paragraphe dans un `span` n'est pas du HTML
               * valide. La feuille cible `.note .bd` — elle ne voit pas la
               * différence, le validateur si.
               */}
              <div className="bd">
                <p>
                  {t("pme.charges.question", {
                    famille: a.label,
                    value: pct(a.deviationRatio),
                    baseline: montant(a.baseline, locale) + " " + pme.currency,
                    observed: montant(a.observed, locale) + " " + pme.currency,
                  })}
                </p>
                {faite ? (
                  <p>
                    {faite.par === "cabinet"
                      ? t("pme.charges.answered.cabinet")
                      : t("pme.charges.answered")}
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={answer.isPending}
                      onClick={() =>
                        answer.mutate({ familleCode: a.familleCode, reply: "exceptionnel" })
                      }
                    >
                      {t("pme.charges.answer.exceptionnel")}
                    </button>{" "}
                    <button
                      type="button"
                      disabled={answer.isPending}
                      onClick={() =>
                        answer.mutate({ familleCode: a.familleCode, reply: "a_verifier" })
                      }
                    >
                      {t("pme.charges.answer.verifier")}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/*
         * ───────────────────────────── ce qui attend sa date ──────────────
         *
         * Sous le total et hors de lui. Posé le 5 octobre 2026, avec la fin
         * du repli sur le mois du scan. Le bloc dit trois choses, et les
         * trois sont nécessaires : COMBIEN de pièces, POURQUOI elles ne
         * comptent pas, et le MONTANT qu'elles représentent — sans quoi
         * l'écart avec ce que la personne attend reste inexpliqué. Il ne
         * s'affiche pas quand il n'y a rien : une information qui apparaît
         * toujours cesse d'être lue.
         *
         * Le geste est un LIEN, pas un bouton : il mène ailleurs. Il ne porte
         * donc pas la pastille de `.note .bd button`, qui ne vise que les
         * boutons — c'est un écart assumé avec le dessin, préféré à un lien
         * déguisé en bouton.
         */}
        {sansDate.data && sansDate.data.pieces > 0 ? (
          <div className="note">
            <img src={portraitMalica} alt="Malica" width={620} height={620} />
            <div className="bd">
              <p>
                {t("pme.charges.sansDate.titre", { count: sansDate.data.pieces })}
                {" — "}
                {t("pme.charges.sansDate.detail", {
                  amount: `${montant(sansDate.data.totalHt ?? "0", locale)} ${pme.currency}`,
                })}
              </p>
              <p>
                <Link to="/pme/list">{t("pme.charges.sansDate.action")}</Link>
              </p>
            </div>
          </div>
        ) : null}

        {/*
         * ─────────────────────── ce que le palier suivant ouvrirait ───────
         *
         * Visibles, jamais masquées, et JAMAIS montrées à qui a déjà payé :
         * `pme.forfait.ouvertures` décide, à un seul endroit du dépôt
         * (`lib/forfait.ts`). Une offre non lue n'ouvre rien — les deux
         * cartes restent alors verrouillées, et c'est la bonne façon de se
         * tromper.
         *
         * Quand l'offre OUVRE l'axe, rien ne paraît ici : ni verrou — il
         * serait faux — ni répartition — elle serait inventée. Les deux axes
         * attendent leur donnée (voir l'en-tête du fichier).
         */}
        {!pme.forfait.ouvertures.sieges || !pme.forfait.ouvertures.societes ? (
          <div className="locks">
            {!pme.forfait.ouvertures.sieges ? (
              <div className="lock">
                <IconeSieges />
                <b>{t("pme.charges.siegesTitre")}</b>
                <span>{t("pme.charges.siegesSous")}</span>
                <em>Team</em>
                {/* nom d'offre : ne se traduit pas */}
              </div>
            ) : null}
            {!pme.forfait.ouvertures.societes ? (
              <div className="lock">
                <IconeSocietes />
                <b>{t("pme.charges.groupeTitre")}</b>
                <span>{t("pme.charges.groupeSous")}</span>
                <em>Premium</em>
              </div>
            ) : null}
          </div>
        ) : null}

        {/*
         * L'échec d'une réponse se dit là où on l'a provoqué. Le dessin n'a
         * pas de bloc pour cela : la classe utilitaire reste donc sur un
         * élément qui n'appartient pas au dessin, et ne touche aucune de ses
         * règles.
         */}
        {error ? (
          <p role="alert" className="mt-3 text-xs text-signal-warn">
            {error}
          </p>
        ) : null}

        <p className="foot">{t("pme.charges.disclaimer")}</p>
      </div>
    </div>
  );
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de `malica-charges.html`. Ils portent `class="g"`,
 * la seule règle d'icône commune aux dix écrans : `stroke:currentColor`,
 * `fill:none`, bouts arrondis. La taille vient du contexte (`.lock svg`),
 * jamais de l'icône.
 */

/** Deux personnes — les sièges d'une équipe. */
function IconeSieges() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="10" r="2.4" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M14.5 19.5a4.5 4.5 0 0 1 6.5-3.4" />
    </svg>
  );
}

/** Trois cadres emboîtés — plusieurs sociétés sous une licence. */
function IconeSocietes() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <rect x="3.5" y="9.5" width="11" height="11" rx="1.5" />
      <path d="M7 6.5h9a1.5 1.5 0 0 1 1.5 1.5v9" />
      <path d="M10 3.5h9A1.5 1.5 0 0 1 20.5 5v9" />
    </svg>
  );
}
