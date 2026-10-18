import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";

import malicaLoin from "@/assets/malica-loin.webp";
import { bienvenueDejaVue } from "@/components/malica/bienvenue";
import { PastilleAEnvoyer } from "@/components/malica/file-locale";
import { MalicaChat } from "@/components/malica/MalicaChat";
import { MandatsProposes } from "@/components/malica/MandatsProposes";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { usePanneauMalica } from "@/components/malica/panneau-malica";
import { usePme } from "@/components/malica/pme-context";
import { useAccueil } from "@/hooks/use-accueil";
import { useSuperposition } from "@/hooks/use-superposition";
import { currentPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { nombre } from "@/lib/forfait";
import { montant, montantSigne } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

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

/*
 * ================================================= LES TROIS LIBELLÉS, AU DICTIONNAIRE
 *
 * « Lectures restantes », « Mes sièges » et « Mes sociétés » vivaient ici en
 * français, nommés comme une dette. Ils sont entrés au dictionnaire le
 * 18 octobre 2026 — `pme.home.lectures`, `pme.home.sieges`,
 * `pme.home.societes` — et se lisent désormais par `t()` dans les trois
 * langues. Rien sur cet écran n'est plus en dur.
 *
 * « Team » et « Premium » restent des littéraux : ce sont les noms des offres,
 * et un nom d'offre ne se traduit pas.
 */

/*
 * ========================================== L'ABONNEMENT VIENT DU CONTEXTE
 *
 * Trente lignes vivaient ici : une interface `Forfait`, un `DepotFacturation`
 * local et un `creerDepotHttp("facturation")` posé à côté du point de
 * composition — donc hors du test qui confronte chaque port au contrat. La
 * capture et les réglages en avaient chacun leur copie, sur deux clés de
 * cache, avec deux règles de dégradation qui ne jugeaient pas le même fait.
 *
 * `FacturationRepository` existe maintenant au socle, `composition.ts` le
 * monte, et le layout `pme.tsx` le lit UNE fois — ce que la règle du câblage
 * demandait depuis le début. Cet écran le reçoit, et ne demande rien.
 */

/**
 * Un entier rendu par la base, ou l'absence — qui s'écrit « — » et jamais « 0 ».
 *
 * Il lisait `typeof valeur === "number"`, et les `integer` de PostgreSQL
 * arrivent en chaînes selon le pilote : un compteur bien rempli aurait pu
 * s'afficher « — ». `nombre()` lit les deux formes, et n'invente aucun zéro.
 */
function compte(valeur: number | string | null | undefined): string {
  const n = nombre(valeur);
  return n === null ? "—" : String(n);
}

/**
 * L'accueil PME — le dessin validé (`livraison/ecrans/malica-accueil.html`,
 * bloc `data-plan="solo"`), porté tel quel.
 *
 * ============================================================== CE QUI A CHANGÉ
 *
 * Le balisage, et lui seul. Le câblage est celui d'avant, ligne pour ligne :
 * `useAccueil(periode)`, `usePme()`, `usePanneauMalica`, la requête
 * `mon-cabinet`, la redirection vers `/pme/bienvenue` pour un dossier neuf,
 * `useSuperposition`, les clés i18n. Les mêmes données, une autre structure.
 *
 * ================================================ LE CSS EXISTE, ON NE L'ÉCRIT PAS
 *
 * `styles-pme.css` porte déjà toutes les règles du dessin sous
 * `[data-surface="pme"] [data-ecran="accueil"]`. Cet écran pose donc
 * `data-ecran="accueil"` sur sa racine et n'emploie QUE les classes du dessin —
 * `.chips .me .chip .pad .tiles .tile .tl .bdg .ar .sec .hero .amb .por .in
 * .sig .cta .stack .acts .act .hd .pg .lock .ask .q .mic .g`. Aucune classe
 * utilitaire par-dessus : une seule d'entre elles contredirait le dessin.
 *
 * `.app` du dessin n'est PAS rendu, et c'est délibéré : la règle portée
 * `[data-ecran="accueil"] .app{padding-top:4rem}` réservait la place de la
 * rangée de démonstration « Basic · Solo · Team · Premium », qui n'existe pas
 * dans l'application. Le cadre (largeur maximale, fond, aires sûres) est déjà
 * tenu par le layout `pme.tsx`.
 *
 * `.nav` non plus : la barre du bas est rendue par `pme.tsx`, une fois pour
 * tous les écrans PME. La redessiner ici en ferait deux.
 *
 * ================================================== L'ABONNEMENT NE S'AFFICHE PAS
 *
 * La rangée des quatre forfaits est une affordance de maquette. Dans
 * l'application, l'offre se voit à deux endroits seulement : le compteur de
 * lectures, et les cartes `.lock` — visibles, jamais masquées, parce qu'un
 * produit qui cache ce qu'il vend ne le vend pas.
 *
 * ============================================ CE QUI N'EST PAS BRANCHÉ, ET POURQUOI
 *
 * `cabinet.documents` et `cabinet.accuserReception` n'existent pas : le dépôt
 * `cabinet` n'est pas au contrat. Aucun appel n'est inventé pour eux — l'écran
 * du cabinet côté PME viendra avec sa route.
 *
 * `facturation.monForfait`, lui, est au contrat et branché ci-dessous. Son
 * implémentation d'API s'écrit pendant que ceci se lit : la carte des lectures
 * et les cartes verrouillées doivent donc tenir sans elle. Chargement, échec,
 * licence absente — les trois rendent la même chose : « — », jamais « 0 ».
 * Zéro est un fait comptable ; l'absence n'en est pas un.
 */
function PmeHome() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const malica = usePanneauMalica("pme");
  useSuperposition(malica.ouvert, malica.fermer);
  const periode = currentPeriod();
  const a = useAccueil(periode);
  const navigate = useNavigate();

  /*
   * La pastille du haut porte l'initiale de la PERSONNE, pas celle de Malica.
   *
   * Elle vient du compte ouvert — `beforeLoad` de `_authenticated` le range au
   * contexte — et non d'un appel de plus : la garde l'a déjà en main à chaque
   * navigation. Le compte ne porte qu'un identifiant et une adresse : c'est
   * donc la première lettre de l'adresse, faute de nom en base.
   */
  const { user } = useRouteContext({ from: "/_authenticated" });
  const initiale = (user.email.trim().charAt(0) || "·").toLocaleUpperCase(locale);

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

  /*
   * L'OFFRE, LUE UNE FOIS — PAR LE LAYOUT.
   *
   * La licence appartient à la PERSONNE, pas au dossier. Le layout la lit
   * sans `tenantId` et la passe par contexte ; cet écran la reçoit.
   *
   * Pas de repli : `ligne` vaut `null` pendant le chargement comme en cas
   * d'échec, et `null` aussi quand il n'y a pas de licence. Les trois sont la
   * même chose à l'écran — on ne sait pas — et l'écran le dit d'une seule
   * façon. Une valeur de secours à 0 serait une affirmation.
   */
  const f = pme.forfait.ligne;

  /*
   * Ce que l'offre ouvre — décidé dans `lib/forfait.ts`, à un seul endroit.
   *
   * Il y en avait deux : ici sur le nom de l'offre, aux réglages sur
   * `sieges_max`. Deux écrans jugeaient le même fait sur deux données
   * différentes. Une offre inconnue — chargement, échec, licence absente —
   * n'ouvre rien : la carte reste verrouillée, et verrouillée elle dit ce
   * qu'elle ferait.
   */
  const siegesOuverts = pme.forfait.ouvertures.sieges;
  const societesOuvertes = pme.forfait.ouvertures.societes;

  /*
   * La jauge du plafond : elle n'existe que si les DEUX bornes sont connues.
   * Sans elles, pas de barre — une jauge sans donnée est un graphique
   * décoratif, et ce fichier en a retiré trois le 11 octobre pour cette
   * raison exacte.
   */
  const lecturesPart = (() => {
    const reste = nombre(f?.lectures_restantes);
    const droit = nombre(f?.lectures_droit);
    if (reste === null || droit === null || droit <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((reste / droit) * 100)));
  })();

  const mois = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );
  const moisCourant = mois(periode);

  const heure = new Date().getHours();
  const salut = t(
    heure < 12
      ? "pme.home.greet.morning"
      : heure < 18
        ? "pme.home.greet.afternoon"
        : "pme.home.greet.evening",
  );

  /*
   * ================================================= « PRESQUE » À 0 %, ET POURQUOI
   *
   * 10 octobre 2026. L'accueil disait « Presque. Il me manque encore quelques
   * factures » pendant que la carte d'à côté disait « prête à 0 % ». La cause
   * tenait en une ligne : un booléen déguisé en nombre, et « quelques
   * factures » inventait une quantité que le produit ne peut pas connaître.
   *
   * La phrase dit ce qui est VRAI et sur quoi on peut agir : ce qui attend une
   * réponse, compté, ou rien. Elle porte maintenant le titre de la carte à la
   * une, à la place de « 3 pièces. On les vérifie ? » du dessin — qui disait la
   * même chose, avec un nombre que seul le socle connaît.
   */
  const phrase =
    a.avancement === null
      ? t("pme.home.voix.rien")
      : a.enAttente === 0
        ? t("pme.home.voix.enOrdre", { mois: moisCourant })
        : t("pme.home.voix.attendent", { count: a.enAttente, mois: moisCourant });

  /*
   * L'écart avec le mois précédent — la seule phrase de cet écran qui compare.
   * `null` d'un côté ou de l'autre et elle l'avoue : « pas encore de quoi
   * comparer » plutôt qu'un zéro qui passerait pour une stagnation.
   */
  const ecartPhrase =
    a.ecart === null
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
          });

  // Ce que le cabinet a retourné, dit à son nom quand on le connaît.
  const attendCabinet = cabinet.data
    ? t("pme.home.attend.cabinet", { cabinet: cabinet.data.name, count: a.retournees })
    : t("pme.home.attend", { count: a.retournees });

  /*
   * ===================================================== LA CARTE À LA UNE, ET SON GESTE
   *
   * Trois situations, trois phrases, et un bouton qui n'est JAMAIS un
   * cul-de-sac :
   *
   *   le cabinet a retourné quelque chose → ce qu'il attend   → ouvrir ce qui est à régler
   *   des pièces attendent une réponse    → combien, comptées → ouvrir la liste
   *   rien n'attend                       → l'état du mois    → photographier
   *
   * Le dernier cas couvre aussi le dossier vide : le geste proposé est celui
   * qui fait exister le produit, pas un lien vers une liste sans lignes.
   */
  const aRegler = a.retournees > 0;
  const aVerifier = a.enAttente > 0;
  const titreHero = aRegler ? attendCabinet : phrase;
  const sousHero = aRegler ? phrase : ecartPhrase;

  return (
    /*
     * `data-ecran="accueil"` : le marqueur qui fait descendre sur cet arbre les
     * 80 règles du dessin. Les marges négatives annulent le `px-4 py-5` du
     * layout — `.chips` et `.pad` portent les leurs, et le dessin ne veut pas
     * de double gouttière.
     */
    <div data-ecran="accueil" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      {/* Un cabinet propose ? Le dirigeant répond avant tout le reste. */}
      <div className="px-5 pt-3">
        <MandatsProposes tenantId={pme.tenantId} />
        <PastilleAEnvoyer />
      </div>

      {/* ------------------------------------------------- la rangée du haut */}
      <div className="chips">
        {/*
         * La pastille est une marque de présence, pas un bouton : le dessin la
         * veut muette. Les portes (réglages, autre espace) sont des chips —
         * `.chip` remet `border:0`, ce que `.me` ne fait pas.
         */}
        <span className="me">{initiale}</span>

        {/*
         * Les chips portent les DOSSIERS, pas des filtres inventés : c'est le
         * sélecteur d'organisation du dessin Premium, qui se réduit tout seul à
         * une chip quand il n'y a qu'une société. Même câblage qu'avant —
         * `pme.dossiers` vient de `identite.listMyOrganizations`, lu une fois
         * par le layout, et `pme.choisirDossier` invalide les requêtes.
         */}
        {pme.dossiers.map((d) => (
          <button
            key={d.id}
            type="button"
            className={cn("chip", d.id === pme.tenantId && "on")}
            aria-pressed={d.id === pme.tenantId}
            onClick={() => pme.choisirDossier(d.id)}
          >
            {d.name}
          </button>
        ))}

        {/*
         * Les deux portes que l'en-tête d'avant portait, et qui n'auraient plus
         * eu de place sur cet écran : les réglages (langue, thème, alertes,
         * échéances) et la bascule vers le cabinet, quand il y a un cabinet où
         * aller. Les supprimer aurait enfermé le dirigeant sur l'accueil.
         */}
        <button
          type="button"
          className="chip"
          onClick={() => void navigate({ to: "/pme/reglages" })}
        >
          {t("pme.reglages.titre")}
        </button>
        {pme.aUnCabinet ? (
          <button type="button" className="chip" onClick={() => void navigate({ to: "/office" })}>
            {t("portal.switch")}
          </button>
        ) : null}
      </div>

      <div className="pad">
        {/* Le salut, sans prénom : le compte n'en porte pas en base (voir ci-dessus). */}
        <h1>{salut}</h1>

        {/* ------------------------------------------------------ les raccourcis */}
        <div className="tiles">
          {/*
           * Ce qui attend une réponse. La pastille ne s'affiche que s'il y a un
           * nombre à dire ; à zéro, la tuile porte le chevron des autres — une
           * pastille « 0 » serait un bruit, pas une information.
           */}
          <button type="button" className="tile" onClick={() => void navigate({ to: "/pme/list" })}>
            <i>
              <IconePiece />
            </i>
            <span className="tl">
              <b>{t("pme.charges.answer.verifier")}</b>
            </span>
            {aVerifier ? <span className="bdg">{a.enAttente}</span> : <Chevron className="g ar" />}
          </button>

          {/* Les charges, et leur sens : `null` d'un côté et la carte se tait. */}
          <button
            type="button"
            className="tile"
            onClick={() => void navigate({ to: "/pme/charges" })}
          >
            <i>
              <IconeBarres />
            </i>
            <span className="tl">
              <b>{t("pme.home.card.charges")}</b>
              <span>
                {a.chargesEcart === null
                  ? t("pme.home.charges.sous")
                  : a.chargesEcart < 0
                    ? t("pme.home.charges.baisse", {
                        pourcent: Math.abs(Math.round(a.chargesEcart)),
                      })
                    : t("pme.home.charges.hausse", { pourcent: Math.round(a.chargesEcart) })}
              </span>
            </span>
            <Chevron className="g ar" />
          </button>

          {/*
           * Le cabinet, nommé. `identite.monCabinet` rend `null` quand il n'y a
           * pas de mandat : la tuile dit alors « votre comptable », et mène quand
           * même à l'écran de ce qui est à régler, qui sait dire qu'il n'y a rien.
           */}
          <button
            type="button"
            className="tile"
            onClick={() => void navigate({ to: "/pme/regler" })}
          >
            <i>
              <IconeSieges />
            </i>
            <span className="tl">
              <b>{cabinet.data ? cabinet.data.name : t("pme.coffre.votreComptable")}</b>
              {/*
               * La tuile dit COMBIEN, pas la phrase entière : « Cabinet X attend
               * deux précisions » est déjà le titre de la carte à la une, et une
               * tuile de 84 px n'est pas un endroit où faire tenir une phrase.
               */}
              <span>
                {aRegler
                  ? t("pme.regler.titre", { count: a.retournees })
                  : t("pme.regler.rien.titre")}
              </span>
            </span>
            <Chevron className="g ar" />
          </button>

          {/*
           * La TVA du mois. Le SIGNE change le mot, pas seulement le chiffre : un
           * solde négatif n'est pas « à reverser », c'est un crédit qui se
           * reporte. Et un solde absent s'écrit « — ».
           */}
          <button type="button" className="tile" onClick={() => void navigate({ to: "/pme/tva" })}>
            <i>
              <IconeRecu />
            </i>
            <span className="tl">
              <b>
                {a.aReverser === null || Number(a.aReverser) > 0
                  ? t("pme.home.reverser")
                  : t("pme.home.credit")}
              </b>
              <span>
                {a.aReverser === null ? "—" : `${montant(a.aReverser, locale)} ${a.devise}`}
              </span>
            </span>
            <Chevron className="g ar" />
          </button>
        </div>

        {/* --------------------------------------------- ce qu'elle a préparé */}
        <div className="sec">
          <h2>{t("pme.home.prepare")}</h2>
          <Link to="/pme/list">
            {t("pme.home.documents.titre")} <Chevron className="g fl" />
          </Link>
        </div>

        <div className="hero">
          <span className="amb" aria-hidden="true" />
          {/*
           * Le portrait du dessin — `malica-loin.webp`, cadré par le CSS en
           * `50% 34%`. Ce n'est pas `MalicaAvatar` : son cadrage `center 18%` et
           * son cercle de marigold appartiennent à l'ancien en-tête.
           */}
          <span className="por">
            <img src={malicaLoin} alt="Malica" width={620} height={620} />
          </span>
          <span className="in">
            <span className="sig">
              <i />
              {t("malica.chat.her")}
            </span>
            <h3>{titreHero}</h3>
            <p>{sousHero}</p>
            {aRegler || aVerifier ? (
              <button
                type="button"
                className="cta"
                onClick={() => void navigate({ to: aRegler ? "/pme/regler" : "/pme/list" })}
              >
                {t("doc.open")}
                <FlecheDroite />
              </button>
            ) : (
              /*
               * Rien n'attend : le geste proposé est celui qui fait exister le
               * produit. `pme.ouvrirScanner` est le même chemin que l'obturateur
               * de la barre du bas — scanner de l'appareil s'il y en a un, le
               * nôtre sinon.
               */
              <button
                type="button"
                className="cta"
                disabled={pme.capturing}
                onClick={() => pme.ouvrirScanner()}
              >
                {t("pme.capture.photo")}
                <FlecheDroite />
              </button>
            )}
          </span>
          <span className="stack" aria-hidden="true">
            <svg viewBox="0 0 48 48" className="g" style={{ strokeWidth: 2 }}>
              <rect x="17" y="7" width="24" height="31" rx="4" transform="rotate(11 29 22.5)" />
              <g transform="rotate(-6 20 27.5)">
                <rect x="8" y="12" width="24" height="31" rx="4" />
                <path className="ln" d="M14 22h12M14 27.5h12M14 33h7" />
              </g>
            </svg>
          </span>
        </div>

        {/* ------------------------------------------------------- l'activité */}
        <div className="sec">
          <h2>{t("pme.home.card.evolution")}</h2>
          <Link to="/pme/echeances">
            {t("pme.home.card.echeances")} <Chevron className="g fl" />
          </Link>
        </div>

        <div className="acts">
          {/*
           * Ce que l'État vous doit — la TVA déductible du mois, rangée au mois
           * où la pièce a été TRANSMISE au cabinet (c'est lui qui la déclare).
           * `null` s'écrit « — » : pas « 0,000 », qui serait un fait comptable.
           */}
          <div className="act">
            <div className="hd">
              <span>{t("pme.verifie.tvaRecuperee")}</span>
              <i>
                <IconeRecu />
              </i>
            </div>
            <b>{a.recuperee === null ? "—" : montant(a.recuperee, locale)}</b>
            <em>
              {a.devise} · {moisCourant}
            </em>
          </div>

          {/*
           * ===================================================== LE PLAFOND DE LECTURES
           *
           * `lectures_restantes` et `lectures_droit` viennent de
           * `facturation.monForfait`. Le nombre s'écrit « — » tant qu'on ne le
           * sait pas, et la barre n'apparaît qu'avec ses deux bornes.
           *
           * La touche de Marigold sous 20 % est celle du dessin — bloc `basic`,
           * « 9 sur 65 » en `var(--touch)`. C'est la seule fois où cette couleur
           * paraît sur l'écran, et elle ne paraît que là : le plafond qui se
           * referme est le seul fait de cet accueil qui ne puisse pas attendre.
           */}
          <div className="act">
            <div className="hd">
              <span>{t("pme.home.lectures")}</span>
              <i>
                <IconeBarres />
              </i>
            </div>
            <b>{compte(f?.lectures_restantes)}</b>
            {/*
             * ====================================== LE TIRET NE SE SUFFIT PAS
             *
             * « — » dit « je n'ai pas le nombre ». Il ne dit pas POURQUOI, et
             * un dirigeant qui lit un vide conclut à une panne. Les deux
             * absences se disent donc en mots, sous le tiret, dans le même
             * `<em>` que la tuile voisine (12 px, une ligne, aucune règle de
             * feuille à écrire) :
             *
             *   — la requête a répondu `null` : il n'y a pas de licence sur ce
             *     compte. Ce n'est pas une panne, c'est un état du produit, et
             *     « Réglages » en porte la phrase longue.
             *   — la requête a échoué : le compteur n'est pas lu. Les lectures
             *     du mois, elles, n'ont pas bougé.
             *
             * Pendant la première lecture, rien n'est dit : une seconde
             * d'attente n'est ni l'une ni l'autre, et la nommer serait faux.
             */}
            {pme.forfait.enCours ? null : pme.forfait.illisible ? (
              <em>{t("pme.home.lectures.illisible")}</em>
            ) : f === null ? (
              <em>{t("pme.home.lectures.sansForfait")}</em>
            ) : null}
            {lecturesPart === null ? null : (
              <span className="pg">
                <i
                  style={{
                    width: `${lecturesPart}%`,
                    ...(lecturesPart <= 20 ? { background: "var(--touch)" } : null),
                  }}
                />
              </span>
            )}
          </div>

          {/*
           * ====================================== CE QUE L'OFFRE OUVRE, ET CE QU'ELLE RETIENT
           *
           * Les sièges s'ouvrent à Team, les sociétés à Premium — c'est `offre`
           * qui tranche, et rien d'autre. Ouverte, la carte porte le chiffre que
           * la base rend ; fermée, elle dit ce qu'elle ferait et sous quelle
           * offre. Elle ne disparaît JAMAIS : un produit qui cache ce qu'il vend
           * ne le vend pas.
           *
           * Les chiffres de ces cartes sont des comptes de la base, pas des
           * noms : « Sami 42 · Nadia 18 » du dessin viendrait de
           * `facturation.sieges`, que cet écran n'appelle pas — un accueil ne
           * charge pas la liste des membres pour écrire deux prénoms.
           */}
          {siegesOuverts ? (
            <div className="act">
              <div className="hd">
                <span>{t("pme.home.sieges")}</span>
                <i>
                  <IconeSieges />
                </i>
              </div>
              {/*
               * « 3 / 5 » : les places prises sur les places incluses. Deux
               * chiffres de la base, aucun mot ajouté — « 3 sièges sur 5 inclus »
               * demanderait une clé qui n'existe pas encore.
               */}
              <b>
                {compte(f?.sieges_occupes)} / {compte(f?.sieges_inclus)}
              </b>
            </div>
          ) : (
            <div className="lock">
              <IconeSieges />
              <b>{t("pme.home.sieges")}</b>
              <em>Team</em>
            </div>
          )}

          {societesOuvertes ? (
            <div className="act">
              <div className="hd">
                <span>{t("pme.home.societes")}</span>
                <i>
                  <IconeSocietes />
                </i>
              </div>
              <b>{compte(f?.organisations)}</b>
            </div>
          ) : (
            <div className="lock">
              <IconeSocietes />
              <b>{t("pme.home.societes")}</b>
              <em>Premium</em>
            </div>
          )}
        </div>

        {/*
         * ------------------------------------------------- la barre de question
         *
         * Elle ouvre le fil de Malica par-dessus l'écran. Le micro est le
         * contrôle : c'est lui qui porte le nom accessible et qui se tient au
         * clavier. La barre entière reste cliquable au doigt.
         */}
        <div className="ask" onClick={malica.ouvrir}>
          <img src={malicaLoin} alt="" width={620} height={620} />
          <span className="q">
            <b>{t("malica.panneau.ouvrir")}</b>
            <span>{t("malica.chat.placeholder")}</span>
          </span>
          <button
            type="button"
            className="mic"
            aria-label={t("malica.panneau.ouvrir")}
            onClick={malica.ouvrir}
          >
            <svg viewBox="0 0 24 24" className="g">
              <rect x="9.2" y="3" width="5.6" height="11" rx="2.8" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
              <path d="M12 18v3" />
            </svg>
          </button>
        </div>
      </div>

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
       * Il était une section de plus dans le flux : l'ouvrir allongeait la page
       * et forçait à faire défiler l'accueil, ce que le dessin interdit. En
       * panneau, il recouvre l'écran le temps de la question et le rend intact.
       * Il garde la langue Edition One : c'est l'écran « converser », qui aura
       * son propre dessin avec la route `pme.malica`.
       */}
      {malica.ouvert ? (
        <div className="pt-safe fixed inset-0 z-30 mx-auto flex w-full max-w-md flex-col bg-background">
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
        </div>
      ) : null}
    </div>
  );
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de `malica-accueil.html`. Ils portent `class="g"`,
 * la seule règle d'icône commune aux dix écrans : `stroke:currentColor`,
 * `fill:none`, bouts arrondis. La taille vient toujours du contexte
 * (`.tile i svg`, `.act .hd i svg`, `.lock svg`, `.ar`), jamais de l'icône.
 */

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

/** Un reçu — ce qui porte un montant. */
function IconeRecu() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </svg>
  );
}

/** Des barres — ce qui se compare. */
function IconeBarres() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V7M17 16v-6" />
    </svg>
  );
}

/** Deux personnes — les sièges, et le cabinet. */
function IconeSieges() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="10" r="2.4" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M14.5 19.5a4.5 4.5 0 0 1 6.5-3.4" />
    </svg>
  );
}

/** Trois cadres emboîtés — plusieurs sociétés sous une licence. */
function IconeSocietes() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <rect x="3.5" y="9.5" width="11" height="11" rx="1.5" />
      <path d="M7 6.5h9a1.5 1.5 0 0 1 1.5 1.5v9" />
      <path d="M10 3.5h9A1.5 1.5 0 0 1 20.5 5v9" />
    </svg>
  );
}

/** Le chevron des tuiles et des titres de section. */
function Chevron({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

/**
 * La flèche du bouton de la carte à la une.
 *
 * `fl` est le marqueur que la feuille miroite en arabe : gardée telle quelle,
 * une flèche « suivante » pointe vers ce qu'on vient de lire.
 */
function FlecheDroite() {
  return (
    <svg viewBox="0 0 24 24" className="g fl">
      <path d="M4.5 12h14" />
      <path d="M14 7.5l4.5 4.5L14 16.5" />
    </svg>
  );
}
