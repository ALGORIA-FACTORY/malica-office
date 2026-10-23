import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { coque, COMMERCE, versionClient } from "@/capabilities/coque";
import {
  ARegler,
  MesFactures,
  ChangerDOffre,
  MesProprietaires,
  MesRecharges,
  MonNom,
  PayerALAnnee,
} from "@/components/malica/abonnement-pilote";
import { useApparence, type Apparence } from "@/components/malica/apparence";
import { InviterDansMonDossier } from "@/components/malica/inviter-dans-mon-dossier";
import { usePme } from "@/components/malica/pme-context";
import { SeDeconnecter } from "@/components/malica/se-deconnecter";
import { usePrix } from "@/hooks/use-decimales";
import { libelleDOffre, offresQuiOuvrent, useCatalogueDesOffres } from "@/hooks/use-offres";
import { useI18n, LOCALES, LOCALE_NAMES, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { nombre as entier, ouverturesDuForfait } from "@/lib/forfait";
import { CANAL } from "@/lib/telemetrie";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  MonForfait,
  OffreAuCatalogue,
  OrganisationDeLaLicence,
  SiegeDeLaLicence,
} from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/reglages")({
  head: () => ({
    meta: [
      { title: "Réglages — Malica Office" },
      { name: "description", content: "Langue, apparence, et ce dont Malica vous prévient." },
      { property: "og:title", content: "Réglages — Malica Office" },
      {
        property: "og:description",
        content: "Langue, apparence, et ce dont Malica vous prévient.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeReglages,
});

/**
 * Mon espace — le compte, l'abonnement, les organisations, les sièges, les
 * données, et ce que l'appareil fait tourner.
 *
 * ================================================================ LE DESSIN
 *
 * Cet écran suit `malica-parametres.html`. Le balisage porte les classes de
 * `styles-pme.css`, section « écran · parametres » (`.sec`, `.card`, `.moi`,
 * `.abo`, `.bar`, `.org`, `.etat`, `.grp`, `.sg`, `.inv`, `.rows`, `.rw`,
 * `.note`) : la feuille existe, elle n'a pas à être réécrite en utilitaires.
 * `data-ecran="parametres"` est posé une fois, sur la racine ;
 * `data-surface="pme"` l'est par le layout `pme.tsx`, et nulle part ailleurs.
 *
 * Trois choses de la maquette ne sont PAS portées, et c'est délibéré :
 *
 *   — la rangée « Basic · Solo · Team · Premium » en tête, en onglets. Depuis
 *     le 19 octobre 2026, l'offre SE CHOISIT bien depuis l'application — par
 *     le propriétaire principal, dans « Changer d'offre » plus bas
 *     (`abonnement-pilote.tsx`), sur la grille que la base rend, avec ce qui
 *     empêcherait d'y passer. Pas dans un onglet de démonstration.
 *   — `.app`, `.top` et `.nav`. Le layout les tient déjà : deux cadres
 *     concentriques feraient deux barres de navigation.
 *   — le TTC calculé dans l'écran (« HT × 1,19 + 1 DT de timbre »). Un taux
 *     de TVA et un droit de timbre sont des faits fiscaux : depuis le
 *     19 octobre 2026, le TTC s'affiche, mais c'est la base qui le calcule
 *     (`public.prix_ttc`), par la fiscalité de la facture (R3, R4).
 *
 * ======================================================== L'ABONNEMENT, LU
 *
 * Le dépôt `facturation` est au contrat depuis le 17 octobre — cinq méthodes,
 * relevées dans `contrat/rpc.json` : `monForfait`, `sieges`, `organisations`,
 * `inviterSiege`, `libererPlace`. Cet écran les appelle pour de bon.
 *
 * Deux règles tiennent pendant que l'implémentation côté API s'écrit :
 *
 *   — une valeur absente s'écrit « — », jamais « 0 ». Zéro est un fait
 *     comptable, l'absence n'en est pas un, et les confondre sur l'écran qui
 *     porte la facture est la faute que ce produit ne peut pas se permettre.
 *   — `isPending` et `isError` se disent en toutes lettres, au même endroit :
 *     `useLAbonnement()`, plus bas. C'est le SEUL endroit du fichier qui lit
 *     le forfait, et le seul à monter quand la lecture passera dans le layout
 *     et descendra par `pme-context` (un écran, une fenêtre de données).
 *
 * Et le plafond ne se vérifie jamais ici : il mord dans la base, par le
 * déclencheur `memberships_place_disponible`. L'écran invite, la base refuse,
 * l'écran montre le refus. Une seconde vérité côté client serait pire
 * qu'aucune (R6).
 *
 * ========================================= LA RÈGLE DE DÉGRADATION, ENTIÈRE
 *
 * Ce qu'un forfait ne donne pas apparaît verrouillé et VISIBLE, jamais masqué.
 * Un dirigeant en Basic doit lire « Mes sièges · Team » : c'est ainsi qu'il
 * apprend que l'offre existe. Un produit qui cache ce qu'il vend ne le vend
 * pas. `degradation()` en décide seule, et seulement depuis le forfait.
 */
function PmeReglages() {
  const { t, locale, setLocale } = useI18n();
  const { apparence, choisir } = useApparence();
  const pme = usePme();
  const aLEchelle = usePrix();
  const catalogue = useCatalogueDesOffres().data;

  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });

  const abo = useLAbonnement();
  const f = abo.forfait;
  const verrous = degradation(f, t, catalogue);
  const bientot = lecturesQuiSAchevent(f);

  const apparences: Array<{ cle: Apparence; label: string }> = [
    { cle: "systeme", label: t("pme.reglages.apparence.systeme") },
    { cle: "paper", label: t("pme.reglages.apparence.paper") },
    { cle: "ink", label: t("pme.reglages.apparence.ink") },
  ];

  return (
    <div data-ecran="parametres" className="rg-rise">
      <h1>{t("pme.reglages.titre")}</h1>

      {/* ─────────────────────────────────────────────────── le compte */}
      <div className="sec">
        <h2>{t("pme.reglages.compte")}</h2>
        <span>{t("pme.reglages.compte.sous")}</span>
      </div>
      <div className="card">
        <div className="moi">
          <span className="av">{initiale(compte.data?.email ?? null)}</span>
          <span className="bd">
            {/*
             * Le Socle ne porte pas de nom d'usage : `Compte` est
             * `{ id, email }`. On montre donc l'adresse, et on n'invente pas le
             * nom de la maquette — un nom fabriqué par l'interface est un nom
             * faux le jour où quelqu'un d'autre se connecte.
             */}
            <b>{compte.data?.email ?? ABSENT}</b>
            <span>{pme.orgName}</span>
            {/*
             * Le pluriel passe par `count` : « 1 organisation(s) » n'existe
             * dans aucune langue, et l'arabe ne s'accorde pas comme le
             * français. `Intl.PluralRules` tranche à notre place.
             */}
            <span className="ro">
              {t("pme.reglages.compte.orgs", { count: pme.dossiers.length })}
            </span>
          </span>
        </div>
        <MonNom />
        <SeDeconnecter className="btn btn-sec mt-2" />
      </div>

      {/* ─────────────────────────────────────────────── l'abonnement */}
      <div className="sec">
        <h2>{t("pme.reglages.abo")}</h2>
        <span>{t("pme.reglages.abo.sous")}</span>
      </div>
      <div className="card abo">
        <div className="nm">
          <b>{f?.offre ? libelleDOffre(catalogue, f.offre) : ABSENT}</b>
          {COMMERCE ? (
            <span className="px">
              {f?.prix_mensuel_ht ? `${aLEchelle(f.prix_mensuel_ht)} ${pme.currency}` : ABSENT}
            </span>
          ) : null}
        </div>
        {COMMERCE ? (
          <>
            <p className="ttc">{t("pme.reglages.abo.ht")}</p>
            <TtcEtReport ht={f?.prix_mensuel_ht ?? null} />
          </>
        ) : null}

        <div className="det">
          <div>
            <u>{t("pme.reglages.abo.organisations")}</u>
            <b>{nombre(f?.organisations, locale)}</b>
          </div>
          <div>
            <u>{t("pme.reglages.abo.siegesOccupes")}</u>
            <b>
              {nombre(f?.sieges_occupes, locale)} / {nombre(f?.sieges_inclus, locale)}
            </b>
          </div>
          <div>
            <u>{t("pme.reglages.abo.siegesMax")}</u>
            <b>{plafond(f, locale, t)}</b>
          </div>
          <div>
            <u>{t("pme.reglages.abo.lectures")}</u>
            <b>{nombre(f?.lectures_droit, locale)}</b>
          </div>
          <div>
            <u>{t("pme.reglages.abo.statut")}</u>
            <b>{f?.statut ?? ABSENT}</b>
          </div>
        </div>

        <div className="q">
          <span className="hd">
            <u>{t("pme.reglages.abo.consommees")}</u>
            <b>
              {nombre(f?.lectures_consommees, locale)} / {nombre(f?.lectures_droit, locale)}
            </b>
          </span>
          {/*
           * La barre ne se remplit que si les deux nombres existent. Une barre
           * vide se lit « zéro lecture ce mois » — un fait, et il serait faux.
           * Sans la ligne, on montre la piste nue et on dit pourquoi.
           */}
          {f ? (
            <span className={cn("bar", bientot !== null && "hot")}>
              <i style={{ width: `${remplissage(f)}%` }} />
            </span>
          ) : (
            <span className="bar" aria-hidden />
          )}
          {bientot !== null ? (
            <p className="warn">{t("pme.reglages.abo.bientot", { count: bientot })}</p>
          ) : null}
          {abo.ennui ? <p className="warn">{abo.ennui}</p> : null}
          {COMMERCE ? <p className="nxt">{t("pme.reglages.abo.facture")}</p> : null}
        </div>
      </div>

      {/* ──────────────────────────── changer d'offre, et les recharges */}
      {/*
       * Le `<span>` d'un `.sec` est une ÉTIQUETTE courte (« Licence en
       * direct ») : une phrase y écrasait le titre en colonne d'une lettre,
       * relevé sur l'appareil le 19 octobre. La phrase va dessous.
       */}
      {COMMERCE ? (
        <>
          <div className="sec">
            <h2>{t("pme.reglages.offres")}</h2>
          </div>
          <p className="t-body">{t("pme.reglages.offres.sous")}</p>
          <ChangerDOffre />
          <PayerALAnnee />
          <ARegler />
          <MesFactures />

          <div className="sec">
            <h2>{t("pme.reglages.recharges")}</h2>
          </div>
          <p className="t-body">{t("pme.reglages.recharges.sous")}</p>
          <MesRecharges />
        </>
      ) : null}

      {/* ───────────────────────────────────────────── les organisations */}
      <div className="sec">
        <h2>{t("pme.reglages.orgs")}</h2>
        <span>
          {t("pme.reglages.surTotal", {
            n: abo.organisations.length,
            total: nombre(f?.organisations, locale),
          })}
        </span>
      </div>
      {abo.organisations.map((o) => (
        <Organisation key={o.tenantId} org={o} courante={o.tenantId === pme.tenantId} />
      ))}
      {abo.organisations.length === 0 ? (
        <div className="card">
          <p className="t-body">{abo.ennui ?? t("pme.reglages.orgs.aucune")}</p>
        </div>
      ) : null}
      {/*
       * « Une deuxième société ». Ouverte, elle ajoute une organisation à la
       * licence ; verrouillée, elle dit sous quelle offre elle s'ouvre. Elle ne
       * disparaît dans aucun des deux cas.
       */}
      <div className="grp">
        {verrous.societes.ouvert ? (
          <Link to="/onboarding" className="inv">
            <i>
              <IcPlus />
            </i>
            <span className="bd">
              <b>{t("pme.reglages.orgs.ajouter")}</b>
              <span>{t("pme.reglages.orgs.ajouter.sous")}</span>
            </span>
          </Link>
        ) : COMMERCE ? (
          /*
           * `data-verrou` est la marque commune des cartes verrouillées : elle
           * les rend repérables d'un écran à l'autre, et c'est elle qu'une
           * épreuve peut interroger pour vérifier qu'aucune n'a été masquée.
           */
          <div className="inv off" data-verrou={verrous.societes.offre}>
            <i>
              <IcCadenas />
            </i>
            <span className="bd">
              <b>{t("pme.home.societes")}</b>
              <span>{t("pme.reglages.societes.verrou")}</span>
              <em>{verrous.societes.offre}</em>
              {verrous.societes.raison ? <span>{verrous.societes.raison}</span> : null}
            </span>
          </div>
        ) : null}
      </div>

      {/* ───────────────────────────────────────────────────── les sièges */}
      <div className="sec">
        <h2>{t("pme.reglages.sieges")}</h2>
        <span>
          {t("pme.reglages.surTotal", {
            n: nombre(f?.sieges_occupes, locale),
            total: plafond(f, locale, t),
          })}
        </span>
      </div>
      <p className="t-body">{t("pme.reglages.sieges.sous")}</p>
      <Sieges abo={abo} verrou={verrous.sieges} />

      {/*
       * ============================================= UNE SEULE INVITATION
       *
       * L'écran en portait trois le 19 octobre — « Qui entre dans ce
       * dossier », « Inviter un siège » sous chaque société, « Inviter un
       * propriétaire ». Il n'en reste qu'une, qui choisit le rôle
       * (`inviter-dans-mon-dossier.tsx`), et elle n'apparaît que si l'offre
       * porte des places : sinon c'est la carte verrouillée, plus haut, qui
       * parle. La transmission de la licence suit, seulement quand il y a un
       * autre propriétaire à qui la transmettre.
       */}
      {verrous.sieges.ouvert ? (
        <>
          {/* Inviter peut ajouter une place payée au-delà des places incluses :
              c'est un achat, donc sur le web et la PWA seulement (`COMMERCE`). */}
          {COMMERCE ? <InviterDansMonDossier /> : null}
          <MesProprietaires />
        </>
      ) : null}

      {/* ──────────────────────── la fiche, les alertes, les échéances */}
      <div className="sec">
        <h2>{t("fiche.titre")}</h2>
      </div>
      <div className="rows">
        {/*
         * La porte vers la situation fiscale. Elle est ici et non sur
         * l'accueil : ce réglage se fait une fois puis se revisite rarement.
         * Mais il commande la moitié des réponses de Malica — sans régime
         * connu, elle ne peut ni qualifier une opération ni répondre sur une
         * déduction.
         */}
        <Link to="/pme/fiche" className="rw">
          <span className="bd">
            <b>{t("fiche.champ.imposition")}</b>
            <span>{t("fiche.sous")}</span>
          </span>
          <IcChevron />
        </Link>
        {/*
         * Pas d'interrupteurs de notification : rien n'envoie encore. On mène
         * là où les alertes existent réellement plutôt que de faire basculer
         * trois boutons qui ne changeraient rien. Ils reviendront avec l'envoi.
         */}
        <Link to="/pme/notifications" className="rw">
          <span className="bd">
            <b>{t("pme.nav.notifs")}</b>
            <span>{t("pme.reglages.alertes.sous")}</span>
          </span>
          <IcChevron />
        </Link>
        <Link to="/pme/echeances" className="rw">
          <span className="bd">
            <b>{t("pme.nav.echeances")}</b>
            <span>{t("pme.reglages.echeances.sous")}</span>
          </span>
          <IcChevron />
        </Link>
      </div>

      {/* ───────────────────────────────── la langue et l'apparence */}
      <div className="sec">
        <h2>{t("pme.reglages.langue")}</h2>
      </div>
      <div className="seg">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={l === locale}
            className={cn(l === locale && "on")}
          >
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>

      <div className="sec">
        <h2>{t("pme.reglages.apparence")}</h2>
      </div>
      <div className="seg">
        {apparences.map((a) => (
          <button
            key={a.cle}
            type="button"
            onClick={() => choisir(a.cle)}
            aria-pressed={a.cle === apparence}
            className={cn(a.cle === apparence && "on")}
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="foot">{t("pme.reglages.apparence.note")}</p>

      {/* ───────────────────────────────────────────────── vos données */}
      <div className="sec">
        <h2>{t("pme.reglages.donnees")}</h2>
        <span>{t("pme.reglages.donnees.sous")}</span>
      </div>
      <div className="rows">
        <Link to="/pme/coffre" className="rw">
          <span className="bd">
            <b>{t("pme.reglages.donnees.espace")}</b>
            <span>{t("pme.reglages.donnees.espace.sous")}</span>
          </span>
          <IcChevron />
        </Link>
        <Link to="/pme/list" className="rw">
          <span className="bd">
            <b>{t("pme.reglages.donnees.biblio")}</b>
            <span>{t("pme.reglages.donnees.biblio.sous")}</span>
          </span>
          <IcChevron />
        </Link>
        <div className="rw">
          <span className="bd">
            <b>{t("pme.reglages.donnees.conservation")}</b>
            <span>{t("pme.reglages.donnees.conservation.sous")}</span>
          </span>
          <span className="vl">{t("pme.reglages.donnees.conservation.valeur")}</span>
        </div>
        {/*
         * Le bouton éteint « Changer de forfait » est parti le 19 octobre :
         * l'offre se change pour de bon dans « Changer d'offre », plus haut.
         * Un second geste, mort, au même écran, se lisait « pas encore ».
         */}
      </div>

      <div className="note">
        <p>{t("pme.reglages.note")}</p>
      </div>

      {/* ───────────────────────── signaler, les pannes, la version */}
      <div className="sec">
        <h2>{t("pme.reglages.signaler")}</h2>
      </div>
      <Signalement />
      <PannesConstatees />

      <div className="sec">
        <h2>{t("pme.reglages.version")}</h2>
      </div>
      <Versions />

      <p className="foot">{t("pme.reglages.pied")}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * L'ABONNEMENT — UN SEUL ENDROIT LE LIT
 * ══════════════════════════════════════════════════════════════════════════ */

/*
 * ===================================== LES TYPES ET LE DÉPÔT SONT PARTIS AU SOCLE
 *
 * Quatre interfaces et un `creerDepotHttp("facturation")` vivaient ici, avec
 * leur mode d'emploi pour le jour où le port arriverait. Il est arrivé :
 * `FacturationRepository` est déclaré dans
 * `packages/socle/src/ports/repositories.ts` et monté dans `composition.ts`.
 *
 * Ce que ce déplacement achète, et ce n'est pas du rangement : un dépôt monté
 * hors de `composition.ts` échappe au test qui confronte chaque port au
 * contrat de l'API. Une méthode mal nommée ne se voyait qu'à l'exécution, sur
 * l'écran de quelqu'un.
 *
 * Et les trois écrans qui en avaient chacun leur copie — accueil, capture,
 * réglages — lisent désormais le même objet, lu UNE fois par le layout.
 */

/** Les clés de requête de l'abonnement, en un endroit : l'invitation les invalide. */
const CLE_FORFAIT = "mon-forfait";
const CLE_SIEGES = "forfait-sieges";
const CLE_ORGANISATIONS = "forfait-organisations";

interface LAbonnement {
  forfait: MonForfait | null;
  organisations: Array<{ tenantId: string; nom: string; lectures: number | null }>;
  sieges: SiegeDeLaLicence[];
  /** Vrai pendant la première lecture : « — » est alors une attente, pas une absence. */
  enCours: boolean;
  /**
   * Ce qui empêche de lire l'abonnement, dit à un dirigeant : un réseau
   * absent, un refus de l'API, ou une licence qu'il ne détient pas. `null`
   * quand tout va bien.
   */
  ennui: string | null;
}

/**
 * L'abonnement de cette licence — forfait, organisations, sièges.
 *
 * ======================================================== TROIS LECTURES, UNE
 *
 * Trois appels, montés ensemble, lus une fois : aucun autre endroit de cet
 * écran n'appelle `facturation`. Le jour où l'accueil et la capture auront
 * besoin du même forfait, cette fonction monte dans le layout `pme.tsx` et
 * descend par `pme-context` — un écran, une fenêtre de données, et aucun écran
 * qui appelle deux fois.
 *
 * ============================================== DEUX ABSENCES, PAS UNE SEULE
 *
 * `monForfait` rend `null` à qui ne détient AUCUNE licence : un collaborateur
 * n'en détient pas, et la base ne lui en montre aucune. Ce n'est pas la même
 * chose qu'un réseau coupé ou qu'un refus, et la phrase affichée le distingue —
 * sinon le dirigeant conclut qu'il n'a pas payé.
 *
 * `retry: false` : si l'API refuse, on le dit tout de suite. Trois tentatives
 * silencieuses, c'est huit secondes de « — » sans explication.
 */
function useLAbonnement(): LAbonnement {
  const { t } = useI18n();
  const pme = usePme();

  const acces = useQuery({
    queryKey: ["pme-acces", pme.tenantId],
    queryFn: () => office().acces.monAcces(pme.tenantId),
  });

  /*
   * Le forfait ne se redemande pas : le layout l'a lu, sans `tenantId`,
   * puisque la licence appartient à la personne. Cet écran lisait
   * `["mon-forfait", tenantId]` quand l'accueil lisait `["mon-forfait"]` —
   * deux entrées de cache et un aller-retour de trop pour la même donnée.
   */
  const forfait = pme.forfait;

  const organisations = useQuery({
    queryKey: [CLE_ORGANISATIONS, pme.tenantId],
    queryFn: () => office().facturation.organisations(),
    retry: false,
  });
  const sieges = useQuery({
    queryKey: [CLE_SIEGES, pme.tenantId],
    queryFn: () => office().facturation.sieges(),
    retry: false,
  });

  const panne = organisations.error ?? sieges.error ?? null;
  const role = acces.data?.role ?? null;

  const ennui = forfait.illisible
    ? t("pme.reglages.verrou.nonLu")
    : panne
      ? texteDeLErreur(panne, "routes/_authenticated/pme.reglages", t("common.error"))
      : forfait.enCours
        ? null
        : forfait.ligne === null
          ? role === "collaborateur"
            ? t("pme.reglages.abo.collaborateur")
            : t("pme.reglages.abo.sansLicence")
          : null;

  /*
   * ========================================= LE REPLI, ET CE QU'IL NE FAIT PAS
   *
   * Tant que `facturation.organisations` ne répond pas, la liste des sociétés
   * vient des dossiers que le layout a déjà chargés : ce sont de vraies
   * organisations, pas des lignes inventées. Ce qui manque alors, ce sont les
   * lectures consommées par société : elles restent `null`, donc « — ». Le
   * repli ne fabrique jamais un nombre.
   */
  const listeOrgs =
    (organisations.data ?? []).length > 0
      ? (organisations.data ?? []).map((o) => ({
          tenantId: o.tenant_id,
          nom: o.nom,
          lectures: entier(o.lectures_consommees),
        }))
      : pme.dossiers.map((d) => ({ tenantId: d.id, nom: d.name, lectures: null }));

  return {
    forfait: forfait.ligne,
    organisations: listeOrgs,
    sieges: sieges.data ?? [],
    enCours: forfait.enCours || organisations.isPending || sieges.isPending,
    ennui,
  };
}

interface Verrou {
  ouvert: boolean;
  /** L'offre qui l'ouvre, nommée : une carte verrouillée muette ne vend rien. */
  offre: string;
  /** Pourquoi c'est fermé, quand ce n'est pas l'offre qui en décide. */
  raison: string | null;
}

/**
 * La dégradation par offre — décidée dans `lib/forfait.ts`, et nulle part ici.
 *
 * | offre   | ce qui change sur cet écran                                    |
 * |---------|----------------------------------------------------------------|
 * | Basic   | pas de bloc sièges ouvert ; « Mes sièges » et « Mes sociétés » en cartes verrouillées |
 * | Solo    | idem : seul le volume de lectures change                        |
 * | Team    | les sièges s'ouvrent — invitation et reprise de place          |
 * | Premium | les sociétés s'ouvrent, et la vue par société avec elles        |
 *
 * Cette fonction décidait elle-même, et l'accueil décidait autrement : ici
 * `sieges_max > 1`, là `offre === "team" || "premium"`. Deux écrans jugeaient
 * le même fait sur deux données différentes, et les sièges n'étaient donc pas
 * ouverts aux deux endroits par la même règle.
 *
 * Il ne reste ici que l'habillage — le nom de l'offre qui ouvre, et la raison
 * quand ce n'est pas l'offre qui ferme mais le forfait qui n'est pas lu.
 */
function degradation(
  f: MonForfait | null,
  t: (k: MessageKey) => string,
  catalogue: readonly OffreAuCatalogue[] | undefined,
): { sieges: Verrou; societes: Verrou } {
  const ouvertures = ouverturesDuForfait(f, catalogue);
  const ouvrent = offresQuiOuvrent(catalogue);
  const inconnu = f ? null : t("pme.reglages.verrou.nonLu");
  return {
    sieges: { ouvert: ouvertures.sieges, offre: ouvrent.sieges?.libelle ?? "", raison: inconnu },
    societes: {
      ouvert: ouvertures.societes,
      offre: ouvrent.societes?.libelle ?? "",
      raison: inconnu,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * LES BLOCS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Une organisation, et son mandat.
 *
 * Le matricule ne descend que pour le dossier COURANT (`pme.matricule`) : la
 * liste du contexte ne porte qu'un identifiant et un nom. Pour les autres,
 * « — » — et non le matricule du dossier ouvert, qui serait faux.
 *
 * Le mandat se lit par `identite.monCabinet`, sous la MÊME clé de requête que
 * le layout : une seule lecture pour les deux écrans. Son état et sa date
 * (« proposé le… », « actif depuis le… ») ne sont pas dans cette réponse : ils
 * restent dits comme non lus plutôt que devinés.
 */
function Organisation({
  org,
  courante,
}: {
  org: { tenantId: string; nom: string; lectures: number | null };
  courante: boolean;
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const cabinet = useQuery({
    queryKey: ["mon-cabinet", org.tenantId],
    queryFn: () => office().identity.monCabinet(org.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const matricule = courante ? pme.matricule : null;

  return (
    <div className="card org">
      <div className="hd">
        <b>{org.nom}</b>
        <span className={cn("etat", courante ? "ac" : "in")}>
          {courante ? t("pme.reglages.org.ouverte") : t("pme.reglages.org.surLicence")}
        </span>
      </div>
      <span className="mf">
        <IcCadenas />
        {matricule ?? ABSENT}
      </span>
      {/*
       * Deux phrases, pas une coupée en deux : le gras portait un fragment au
       * milieu d'une phrase, et une insertion en milieu de phrase ne se
       * traduit pas — l'ordre des mots change d'une langue à l'autre, et de
       * droite à gauche le fragment atterrit ailleurs. La phrase forte est
       * donc une phrase entière.
       */}
      <p className="mn">
        {t("pme.reglages.org.matricule")} <b>{t("pme.reglages.org.matricule.fort")}</b>
      </p>
      <p className="mn">
        {t("pme.reglages.org.cabinet")}{" "}
        <b>{cabinet.data?.name ?? t("pme.reglages.org.cabinet.aucun")}</b>
      </p>
      <p className="mn">
        {t("pme.reglages.org.lectures")} <b>{nombre(org.lectures ?? undefined, locale)}</b>
      </p>
      {cabinet.data ? <LeMandat tenantId={org.tenantId} /> : null}
      {/* Accepter un abonnement est un geste d'achat : jamais dans la coque. */}
      {COMMERCE ? <AbonnementDeLaComptabilite tenantId={org.tenantId} /> : null}
    </div>
  );
}

/**
 * L'abonnement que la comptabilité propose ou couvre (ANO-011, 21 octobre
 * 2026 ; règles du 20 octobre). La comptabilité propose ; le dirigeant accepte
 * ou refuse. Accepter arrête l'abonnement que la société payait elle-même, le
 * jour même : c'est la comptabilité qui est facturée, au prix public. Rien ne
 * s'affiche quand il n'y a rien à dire.
 */
function AbonnementDeLaComptabilite({ tenantId }: { tenantId: string }) {
  const { t, locale } = useI18n();
  const catalogue = useCatalogueDesOffres().data;
  const qc = useQueryClient();
  const [retour, setRetour] = useState<string | null>(null);
  const propositions = useQuery({
    queryKey: ["abonnements-pour-moi", tenantId],
    queryFn: () => office().facturation.abonnementsPourMoi(tenantId),
  });
  const repondre = useMutation({
    mutationFn: (v: { accesId: string; accepte: boolean }) =>
      office().facturation.repondreAbonnement(v.accesId, v.accepte),
    onSuccess: async (_r, v) => {
      setRetour(t(v.accepte ? "pme.abo.cabinet.accepte" : "pme.abo.cabinet.refuse"));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["abonnements-pour-moi", tenantId] }),
        qc.invalidateQueries({ queryKey: ["mon-forfait"] }),
      ]);
    },
    onError: (e: unknown) =>
      setRetour(texteDeLErreur(e, "routes/_authenticated/pme.reglages", t("common.error"))),
  });
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
          new Date(`${iso}T12:00:00`),
        )
      : "";
  const lignes = (propositions.data ?? []).filter(
    (a) => a.statut === "propose" || a.statut === "actif",
  );
  if (lignes.length === 0 && !retour) return null;
  return (
    <div className="mt-3">
      {lignes.map((a) =>
        a.statut === "actif" ? (
          <p key={a.acces_id} className="mn">
            {t("pme.abo.cabinet.couvert", {
              cabinet: a.cabinet_nom,
              offre: libelleDOffre(catalogue, a.offre_code),
              date: date(a.effet_du),
            })}
          </p>
        ) : (
          <div key={a.acces_id}>
            <p className="mn">
              {t("pme.abo.cabinet.propose", {
                cabinet: a.cabinet_nom,
                offre: libelleDOffre(catalogue, a.offre_code),
              })}
            </p>
            <p className="mn">{t("pme.abo.cabinet.effet")}</p>
            <div className="acts">
              <button
                type="button"
                disabled={repondre.isPending}
                onClick={() => repondre.mutate({ accesId: a.acces_id, accepte: true })}
              >
                {t("pme.abo.cabinet.accepter")}
              </button>
              <button
                type="button"
                className="cut"
                disabled={repondre.isPending}
                onClick={() => repondre.mutate({ accesId: a.acces_id, accepte: false })}
              >
                {t("pme.abo.cabinet.refuser")}
              </button>
            </div>
          </div>
        ),
      )}
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Le TTC du mois et le report du mois dernier, sous le prix HT.
 *
 * Les deux viennent de la base : `prix_ttc` par la fiscalité de la facture
 * (TVA en vigueur, droit de timbre), `mon_report` par le calcul mois par mois
 * de `facturation.report_de`. Sans émetteur désigné, pas de TTC — l'écran se
 * tait plutôt que de supposer un taux (R4).
 */
function TtcEtReport({ ht }: { ht: string | null }) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const aLEchelle = usePrix();
  const ttc = useQuery({
    queryKey: ["prix-ttc", ht],
    queryFn: () => office().facturation.prixTtc(ht!),
    enabled: ht !== null,
    staleTime: 10 * 60 * 1000,
  });
  const report = useQuery({
    queryKey: ["mon-report", pme.tenantId],
    queryFn: () => office().facturation.monReport(pme.tenantId),
  });
  const n = report.data?.report ?? 0;
  return (
    <>
      {ttc.data ? (
        <p className="ttc">
          {t("pme.reglages.abo.ttc", {
            ttc: aLEchelle(ttc.data.ttc),
            devise: pme.currency,
            tva: aLEchelle(ttc.data.tva),
            timbre: aLEchelle(ttc.data.timbre),
          })}
        </p>
      ) : null}
      {n > 0 ? (
        <p className="ttc">
          {t("pme.reglages.abo.report", { count: n, n: new Intl.NumberFormat(locale).format(n) })}
        </p>
      ) : null}
    </>
  );
}

/**
 * Le mandat : se lit, et se révoque.
 *
 * Les deux boutons étaient éteints jusqu'au 19 octobre 2026 — `identite` ne
 * savait ni lire ni révoquer un mandat depuis la PME. `mon_mandat` et
 * `mandat_revoquer` existent désormais.
 *
 * La révocation est irréversible pour cette comptabilité : elle demande un
 * motif (la comptabilité le lira à son journal) et une seconde touche. Elle ne
 * touche pas la licence — c'est la règle des scénarios D.
 */
function LeMandat({ tenantId }: { tenantId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [revoquer, setRevoquer] = useState(false);
  const [motif, setMotif] = useState("");
  const [armee, setArmee] = useState(false);
  const [retour, setRetour] = useState<string | null>(null);

  const mandat = useQuery({
    queryKey: ["mon-mandat", tenantId],
    queryFn: () => office().identity.monMandat(tenantId),
  });
  const fin = useMutation({
    mutationFn: () => office().identity.revoquerMandat(tenantId, motif.trim()),
    onSuccess: async () => {
      setRetour(t("pme.reglages.org.mandat.revoque"));
      setRevoquer(false);
      setArmee(false);
      await qc.invalidateQueries({ queryKey: ["mon-mandat", tenantId] });
      await qc.invalidateQueries({ queryKey: ["mon-cabinet", tenantId] });
    },
    onError: (e: unknown) => {
      setArmee(false);
      setRetour(texteDeLErreur(e, "routes/_authenticated/pme.reglages", t("common.error")));
    },
  });

  const m = mandat.data;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(`${iso}T12:00:00`),
    );

  return (
    <>
      {m?.revocable ? <p className="mn">{t("pme.reglages.org.revocation")}</p> : null}
      <div className="acts">
        <button type="button" onClick={() => setOuvert((v) => !v)} aria-expanded={ouvert}>
          {t("pme.reglages.org.voirMandat")}
        </button>
        {m?.revocable ? (
          <button
            type="button"
            className="cut"
            onClick={() => (setRevoquer((v) => !v), setArmee(false), setRetour(null))}
            aria-expanded={revoquer}
          >
            {t("pme.reglages.org.revoquer")}
          </button>
        ) : null}
      </div>

      {ouvert ? (
        <p className="mn" aria-live="polite">
          {mandat.isPending
            ? t("common.loading")
            : m
              ? t(
                  m.statut === "actif"
                    ? "pme.reglages.org.mandat.actif"
                    : "pme.reglages.org.mandat.propose",
                  {
                    nom: m.comptabilite,
                    date: date(m.depuis),
                  },
                )
              : t("pme.reglages.org.cabinet.aucun")}
        </p>
      ) : null}

      {revoquer && m?.revocable ? (
        <div className="mt-2">
          <p className="t-body">
            {t("pme.reglages.org.mandat.motif.aide", { nom: m.comptabilite })}
          </p>
          <input
            value={motif}
            onChange={(e) => (setMotif(e.target.value), setArmee(false))}
            placeholder={t("pme.reglages.org.mandat.motif")}
            aria-label={t("pme.reglages.org.mandat.motif")}
            className="mt-2 h-[46px] w-full border border-line-strong bg-transparent px-3 text-[14px]"
          />
          <button
            type="button"
            className="btn btn-sec btn-sup mt-2"
            disabled={fin.isPending || motif.trim() === ""}
            onClick={() => (armee ? fin.mutate() : setArmee(true))}
          >
            {armee
              ? t("pme.reglages.org.mandat.confirmer", { nom: m.comptabilite })
              : t("pme.reglages.org.revoquer")}
          </button>
        </div>
      ) : null}

      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </>
  );
}

/**
 * Les sièges, par organisation.
 *
 * La source est `facturation.sieges` : les membres de TOUTES les organisations
 * de la licence, groupés ici par le nom que la vue rend (`organisation`). Le
 * groupement est un calcul sur des données déjà chargées, pas une requête de
 * plus.
 *
 * Ce que la maquette montre et que la vue ne rend pas — les lectures par
 * siège — reste « — ». « 0 » dirait « il n'a rien lu ce mois » : c'est un
 * fait, et on ne l'a pas.
 */
function Sieges({ abo, verrou }: { abo: LAbonnement; verrou: Verrou }) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });
  const acces = useQuery({
    queryKey: ["pme-acces", pme.tenantId],
    queryFn: () => office().acces.monAcces(pme.tenantId),
  });
  const dirigeant = acces.data?.role === "dirigeant";

  const groupes = grouperParOrganisation(abo.sieges);

  return (
    <>
      {groupes.map((g) => (
        <div className="grp" key={g.tenantId}>
          <div className="t">
            <b>{g.organisation}</b>
            <span>
              {t("pme.reglages.surTotal", {
                n: g.lignes.length,
                total: nombre(abo.forfait?.sieges_max, locale),
              })}
            </span>
          </div>
          {g.lignes.map((s) => (
            <Siege
              key={`${s.tenant_id}:${s.user_id}`}
              siege={s}
              moi={s.user_id === compte.data?.id}
              dirigeant={dirigeant}
            />
          ))}
        </div>
      ))}

      {groupes.length === 0 ? (
        <div className="card">
          <p className="t-body">
            {abo.enCours ? t("common.loading") : (abo.ennui ?? t("pme.reglages.sieges.aucun"))}
          </p>
        </div>
      ) : null}

      {/*
       * Fermée, c'est la carte verrouillée, qui nomme l'offre et ne disparaît
       * pas — « Mes sièges · Team » est la seule chose qui apprenne à un
       * dirigeant en Basic que l'offre existe. Ouverte, l'invitation unique
       * suit, sous ce bloc.
       */}
      {verrou.ouvert || !COMMERCE ? null : (
        <div className="inv off" data-verrou={verrou.offre}>
          <i>
            <IcCadenas />
          </i>
          <span className="bd">
            <b>{t("pme.home.sieges")}</b>
            <span>{t("pme.reglages.sieges.verrou")}</span>
            <em>{verrou.offre}</em>
            {verrou.raison ? <span>{verrou.raison}</span> : null}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Une personne sur une place.
 *
 * « Reprendre la place » appelle `facturation.libererPlace`. La base peut
 * refuser : tant qu'il reste des pièces personnelles à trancher, elle rend
 * `{ libere: false, motif, pieces }` — et c'est cette phrase-là qui s'affiche,
 * avec le nombre. Le refus n'est pas une panne : c'est la règle, et elle se
 * lit.
 *
 * Le bouton n'apparaît que pour un dirigeant, et jamais sur sa propre ligne.
 * Ce n'est pas une seconde vérité sur le droit — la base tranche, et elle
 * tranchera quoi qu'il arrive — c'est l'écran qui ne propose pas un geste dont
 * il sait déjà qu'il sera refusé.
 */
function Siege({
  siege,
  moi,
  dirigeant,
}: {
  siege: SiegeDeLaLicence;
  moi: boolean;
  dirigeant: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [retour, setRetour] = useState<string | null>(null);

  const liberer = useMutation({
    mutationFn: () => office().facturation.libererPlace(siege.tenant_id, siege.user_id),
    onSuccess: async (r) => {
      if (r.libere) {
        setRetour(t("pme.reglages.siege.liberee"));
        await qc.invalidateQueries({ queryKey: [CLE_SIEGES] });
        await qc.invalidateQueries({ queryKey: [CLE_FORFAIT] });
      } else {
        /*
         * ======================================= LE MOTIF NE S'AFFICHE PLUS
         *
         * `r.motif` est un CODE de la base — « pieces_personnelles » et ses
         * voisins —, et il était recousu en fin de phrase, entre parenthèses.
         * Deux fautes en une : un identifiant machine sous les yeux d'un
         * dirigeant, et un morceau collé après la phrase, qui atterrit du
         * mauvais côté de droite à gauche.
         *
         * Aucune table ne traduit ces codes, et on n'en invente pas une. La
         * phrase dit donc le fait, qui EST le motif en clair : il reste des
         * pièces personnelles à trancher, et le compte passe par `count`, qui
         * accorde dans chaque langue.
         */
        setRetour(t("pme.reglages.siege.nonLiberee", { count: r.pieces }));
      }
    },
    onError: (e: unknown) =>
      setRetour(texteDeLErreur(e, "routes/_authenticated/pme.reglages", t("common.error"))),
  });

  return (
    <>
      <div className="sg">
        <span className={cn("av", moi && "me")}>{initiale(siege.nom ?? siege.email)}</span>
        <span className="bd">
          {/*
           * Le nom d'usage d'abord ; sans lui, l'adresse — c'est elle que le
           * dirigeant reconnaît. L'identifiant technique ne s'affiche jamais
           * (recette du 21 octobre 2026). Avec un nom, l'adresse se lit
           * dessous.
           */}
          <b>{siege.nom ?? siege.email ?? ABSENT}</b>
          {siege.nom && siege.email ? <span className="ml">{siege.email}</span> : null}
          <span className={cn("ro", siege.role === "dirigeant" && "pr")}>
            <i />
            {roleLisible(siege.role, t)}
          </span>
        </span>
        {/* Les lectures par siège ne sont pas dans `licence_sieges_v`. */}
        <span className="n">
          <b>{ABSENT}</b>
          <span>{t("pme.reglages.siege.lectures")}</span>
        </span>
      </div>
      {dirigeant && !moi ? (
        /*
         * `.acts` n'existe que sous `.org` dans la feuille : ici, c'est le
         * bouton secondaire commun qui sert, avec le survol vermillon des
         * gestes qui retirent quelque chose.
         */
        <button
          type="button"
          className="btn btn-sec btn-sup"
          style={{ width: "auto" }}
          disabled={liberer.isPending}
          onClick={() => liberer.mutate()}
        >
          {t("pme.reglages.siege.reprendre")}
        </button>
      ) : null}
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </>
  );
}

/*
 * Ce que l'appareil fait tourner.
 *
 * Trois nombres, parce qu'il y a trois choses : les ÉCRANS (le bundle web, mis
 * à jour en vol), l'APPLICATION (celle du magasin, qui porte les greffons
 * natifs), et le CANAL (staging, pilote, production — l'adresse de l'API et la
 * file des mises à jour). Pendant le test, c'est la première chose qu'on
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
    <p className="foot">
      {t("pme.reglages.version.ecrans")} {ecrans}
      {native ? (
        <>
          {" · "}
          {t("pme.reglages.version.application")} {native.version} ({native.build})
        </>
      ) : null}
      {" · "}
      {t("pme.reglages.version.canal")} {CANAL}
    </p>
  );
}

/*
 * ============================ CE QUE L'APPLICATION A CONSTATÉ TOUTE SEULE
 *
 * Le complément du signalement, et son contraire : là, c'est la personne qui
 * raconte ; ici, c'est l'application qui dit ce qui a échoué sans qu'on le lui
 * demande.
 *
 * 13 octobre 2026 : « Générer le reçu » ne faisait rien, et la raison était
 * perdue — message hors écran, journal limité au développement. Elle est
 * désormais en base, et elle se relit ICI : une trace que seul un accès à la
 * base permettrait de consulter retomberait exactement dans le défaut qu'elle
 * corrige.
 */
function PannesConstatees() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const pannes = useQuery({
    queryKey: ["pannes", pme.tenantId],
    queryFn: () => office().journal.dernieres(pme.tenantId, 20),
  });

  if ((pannes.data ?? []).length === 0) return null;

  return (
    <>
      <div className="sec">
        <h2>{t("pme.reglages.pannes")}</h2>
      </div>
      <p className="t-body">{t("pme.reglages.pannes.sous")}</p>
      <div className="rows">
        {(pannes.data ?? []).map((p) => (
          <div key={p.id} className="rw">
            <span className="bd">
              <b>{p.message}</b>
              <span>
                {p.ou}
                {p.version ? ` · ${p.version}` : ""}
              </span>
            </span>
            <span className="vl">
              {new Intl.DateTimeFormat(locale, {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(p.at))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/*
 * Signaler un problème.
 *
 * Ni de la télémétrie ni un journal : un geste. La phrase de la personne
 * arrive telle quelle, avec l'écran, l'appareil et la version — ce que le
 * pilote lit chaque semaine. Aucune pièce ne passe par là : pas d'image, pas
 * de montant, pas de texte relevé.
 *
 * Le champ et le bouton gardent leurs utilitaires : la feuille d'écran ne
 * style aucune zone de saisie, et ce bloc marche depuis le 13 octobre.
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
    <div className="card">
      <p className="t-body">{t("pme.reglages.signaler.sous")}</p>
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
        <span className="t-meta" aria-live="polite">
          {retour}
        </span>
        <button
          type="button"
          className="btn"
          style={{ width: "auto" }}
          disabled={message.trim() === "" || envoi.isPending}
          onClick={() => envoi.mutate()}
        >
          {t("pme.reglages.signaler.envoyer")}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * TROIS ÉTATS, JAMAIS DEUX
 *
 * la valeur · le vide (« rien ce mois-ci ») · l'absence (« je ne sais pas
 * encore »). Les trois s'écrivent différemment, et c'est ici que ça se décide.
 * ══════════════════════════════════════════════════════════════════════════ */

/** L'absence. Un tiret cadratin, jamais un zéro. */
const ABSENT = "—";

function nombre(n: number | string | null | undefined, locale: string): string {
  const v = entier(n);
  return v === null ? ABSENT : v.toLocaleString(locale);
}

/**
 * Le plafond de places. Vide quand la ligne est lue (`sieges_inclus` connu) :
 * l'offre n'en a pas (grille du 19 octobre) — on le dit, on n'écrit pas « — ».
 */
function plafond(f: MonForfait | null, locale: string, t: (k: MessageKey) => string): string {
  if (f && f.sieges_max === null && f.sieges_inclus !== null) return t("pme.reglages.sansPlafond");
  return nombre(f?.sieges_max, locale);
}

/**
 * La part consommée du plafond, bornée : une barre à 140 % déborde la carte.
 *
 * Les entiers de PostgreSQL arrivent en chaînes selon le pilote : les lire par
 * `entier()` plutôt que de les supposer `number` évite une barre à `NaN %`.
 */
function remplissage(f: MonForfait): number {
  const droit = entier(f.lectures_droit);
  const consommees = entier(f.lectures_consommees);
  if (droit === null || consommees === null || droit <= 0) return 0;
  return Math.min(100, Math.round((consommees / droit) * 100));
}

/**
 * Combien il en reste quand il n'en reste plus beaucoup — ou `null`.
 *
 * Le seuil n'est pas réglementaire : c'est le moment où l'écran passe du
 * compte rendu à l'avertissement. Il vit dans une constante nommée plutôt
 * qu'écrit deux fois, dans un `cn()` et dans un `t()`.
 */
const AVERTIR_SOUS = 10;
function lecturesQuiSAchevent(f: MonForfait | null): number | null {
  const reste = entier(f?.lectures_restantes);
  return reste !== null && reste <= AVERTIR_SOUS ? reste : null;
}

/** L'initiale de l'avatar — dérivée du nom ou de l'adresse, faute de mieux. */
function initiale(valeur: string | null): string {
  const c = (valeur ?? "").trim().charAt(0);
  return c === "" ? "·" : c.toUpperCase();
}

/** Les deux rôles qu'un dossier de PME connaît ; les autres gardent leur code. */
function roleLisible(
  code: string,
  t: (k: "pme.membres.role.dirigeant" | "pme.membres.role.collaborateur") => string,
): string {
  if (code === "dirigeant") return t("pme.membres.role.dirigeant");
  if (code === "collaborateur") return t("pme.membres.role.collaborateur");
  return code;
}

/**
 * Un groupement, pas une requête : les sièges sont déjà chargés.
 *
 * La clé est `tenant_id` et non le nom : deux sociétés peuvent porter le même
 * nom, et les fondre en un groupe donnerait un plafond de sièges faux. Le nom
 * ne sert qu'à l'affichage, et l'identifiant à l'invitation.
 */
function grouperParOrganisation(
  sieges: readonly SiegeDeLaLicence[],
): Array<{ tenantId: string; organisation: string; lignes: SiegeDeLaLicence[] }> {
  const par = new Map<
    string,
    { tenantId: string; organisation: string; lignes: SiegeDeLaLicence[] }
  >();
  for (const s of sieges) {
    const groupe = par.get(s.tenant_id);
    if (groupe) groupe.lignes.push(s);
    else par.set(s.tenant_id, { tenantId: s.tenant_id, organisation: s.organisation, lignes: [s] });
  }
  return [...par.values()];
}

/* ══════════════════════════════════════════════════════════════════════════
 * LES TROIS ICÔNES DE L'ÉCRAN
 *
 * Elles portent `.g` : la feuille leur donne leur taille, leur épaisseur et
 * leurs jointures, et les règles d'écran les resserrent où il faut (13 px dans
 * `.org .mf`, 18 px pour `.rw .ar`).
 * ══════════════════════════════════════════════════════════════════════════ */

function IcCadenas() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IcPlus() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

function IcChevron() {
  return (
    <svg viewBox="0 0 24 24" className="g ar" aria-hidden>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}
