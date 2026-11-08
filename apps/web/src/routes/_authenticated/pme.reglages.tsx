import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
import { Aide } from "@/components/malica/aide";
import { InviterDansMonDossier } from "@/components/malica/inviter-dans-mon-dossier";
import { usePme } from "@/components/malica/pme-context";
import { SeDeconnecter } from "@/components/malica/se-deconnecter";
import { LienMonEspaceParti } from "@/components/malica/mon-espace-parti";
import { usePrix } from "@/hooks/use-decimales";
import { usePrixEnPlus } from "@/hooks/use-prix-en-plus";
import { libelleDOffre, offresQuiOuvrent, useCatalogueDesOffres } from "@/hooks/use-offres";
import { cleMonCabinet, useMonCabinet } from "@/hooks/use-mon-cabinet";
import { useMonAcces } from "@/hooks/use-mon-acces";
import { useCoteDuPlus } from "@/hooks/use-cote-du-plus";
import { useSuperposition } from "@/hooks/use-superposition";
import { plier } from "@/lib/mes-societes";
import { useI18n, LOCALES, LOCALE_NAMES, type MessageKey } from "@/i18n";
import { direUnRefus, texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnLettres } from "@/lib/lisible";
import { nombre as entier, ouverturesDuForfait } from "@/lib/forfait";
import { CANAL } from "@/lib/telemetrie";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  FicheDeSociete,
  MonForfait,
  OffreAuCatalogue,
  OrganisationDeLaLicence,
  SiegeDeLaLicence,
} from "@malica/socle/ports/repositories";

/** Les pages des Réglages (planche 4) : sans page, le sommaire. */
type PageDesReglages = "abonnement" | "societes" | "utilisateurs";
const PAGES: readonly PageDesReglages[] = ["abonnement", "societes", "utilisateurs"];

export const Route = createFileRoute("/_authenticated/pme/reglages")({
  validateSearch: (s: Record<string, unknown>): { page?: PageDesReglages } =>
    PAGES.includes(s["page"] as PageDesReglages) ? { page: s["page"] as PageDesReglages } : {},
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
  const { cote: coteDuPlus } = useCoteDuPlus();
  const { page } = Route.useSearch();
  const navigate = useNavigate();
  const pme = usePme();
  const aLEchelle = usePrix();
  const catalogue = useCatalogueDesOffres().data;
  const ids = pme.dossiers.length > 0 ? pme.dossiers.map((d) => d.id) : [pme.tenantId];
  /** L'offre et le cabinet de chaque société, en un appel (planche 4). */
  const fiches = useQuery({
    queryKey: ["fiches-des-societes", ...ids],
    queryFn: () => office().facturation.fichesDesSocietes(ids),
    staleTime: 5 * 60 * 1000,
  });
  /** « 100 Basic · 4 Team · 2 Premium » : les offres des sociétés, les plus nombreuses d'abord. */
  const resumeDesOffres = (() => {
    const n = new Map<string, number>();
    for (const x of fiches.data ?? []) if (x.offre) n.set(x.offre, (n.get(x.offre) ?? 0) + 1);
    return [...n.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([o, k]) => `${nombre(k, locale)} ${libelleDOffre(catalogue, o)}`)
      .join(" · ");
  })();

  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });
  // La même lecture que « Mon nom » (`["mon-profil"]`) : une seule requête.
  const profil = useQuery({
    queryKey: ["mon-profil"],
    queryFn: () => office().identity.monProfil(),
  });
  const acces = useMonAcces(pme.tenantId);
  const prixEnPlus = usePrixEnPlus(pme.tenantId);

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
      {page ? (
        <div className="top">
          <button
            type="button"
            className="bk"
            aria-label={t("pme.regler.retour")}
            onClick={() => void navigate({ to: "/pme/reglages", search: {} })}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M14.5 5.5L8 12l6.5 6.5" />
            </svg>
          </button>
          <span className="ttl">
            {page === "abonnement"
              ? t("pme.reglages.abo")
              : page === "societes"
                ? `${t("pme.reglages.orgs")} · ${nombre(abo.organisations.length, locale)}`
                : t("pme.reglages.sieges")}
          </span>
        </div>
      ) : (
        <h1>{t("pme.reglages.titre")}</h1>
      )}

      {/* ─────────────────────────────────────────────────── le compte */}
      {!page ? (
        <>
          {/*
           * 23 octobre 2026 (« trop d'écriture, simplifier sans rien perdre ») :
           * chaque phrase d'explication de cet écran est passée derrière le ⓘ de
           * son titre (`components/malica/aide.tsx`). Rien n'est supprimé.
           */}
          <div className="sec">
            <h2>
              {t("pme.reglages.compte")}
              <Aide
                titre={t("pme.reglages.compte")}
                paragraphes={[{ texte: t("pme.reglages.profil.aide") }]}
              />
            </h2>
          </div>
          {/*
           * Le profil en tête (maquette du 1er novembre 2026) : l'initiale en grand,
           * le nom que la personne a écrit (`identity.profiles`), son adresse, son
           * rôle et sa société. Aucun nom n'est inventé : sans prénom, l'adresse.
           */}
          <div className="card profil">
            <span className="av" aria-hidden>
              {initiale(profil.data?.prenom || compte.data?.email || null)}
            </span>
            <b>
              {[profil.data?.prenom, profil.data?.nom].filter(Boolean).join(" ") ||
                (compte.data?.email ?? ABSENT)}
            </b>
            {profil.data?.prenom ? <span className="ml">{compte.data?.email}</span> : null}
            <span className="pills">
              {acces.data?.role ? (
                <span className="pill">
                  {t(
                    acces.data.role === "dirigeant"
                      ? "pme.membres.role.dirigeant"
                      : "pme.membres.role.collaborateur",
                  )}
                </span>
              ) : null}
              {/* Plusieurs sociétés : chacune a sa carte plus bas, aucune n'est « la » société. */}
              {pme.dossiers.length <= 1 ? <span className="pill neutre">{pme.orgName}</span> : null}
            </span>
            {/*
             * Le pluriel passe par `count` : « 1 organisation(s) » n'existe dans
             * aucune langue, et l'arabe ne s'accorde pas comme le français.
             */}
            <span className="ro">
              {t("pme.reglages.compte.orgs", { count: pme.dossiers.length })}
            </span>
            <MonNom />
            {/* Son Mon espace des sociétés quittées : il part avec le compte (lot 4). */}
            <LienMonEspaceParti className="btn btn-sec mt-2" />
            <SeDeconnecter className="btn btn-sec mt-2" />
          </div>

          {/*
           * ============================================ LE SOMMAIRE (planche 4)
           *
           * 7 novembre 2026, approuvé : « un sommaire court, puis une liste qu'on
           * cherche ». Les Réglages d'un compte de cent sociétés faisaient 55 000
           * pixels — une carte par société, une carte de sièges par société.
           * Chaque thème a désormais sa page ; ce sommaire en dit l'essentiel en
           * chiffres. L'abonnement n'existe pas dans la coque Android.
           */}
          <div className="sommaire">
            {COMMERCE ? (
              <Link to="/pme/reglages" search={{ page: "abonnement" }} className="it">
                <span className="ic acc" aria-hidden>
                  <IcCarte />
                </span>
                <span className="t">
                  <b>{t("pme.reglages.abo")}</b>
                  <span>
                    {resumeDesOffres || (f?.offre ? libelleDOffre(catalogue, f.offre) : ABSENT)}
                  </span>
                </span>
                <IcChevron />
              </Link>
            ) : null}
            <Link to="/pme/reglages" search={{ page: "societes" }} className="it">
              <span className="ic az" aria-hidden>
                <IcImmeuble />
              </span>
              <span className="t">
                <b>{t("pme.reglages.orgs")}</b>
                <span>
                  {fiches.data
                    ? t("pme.reglages.sommaire.avecCompta", {
                        count: fiches.data.filter((x) => x.cabinet).length,
                      })
                    : "\u00a0"}
                </span>
              </span>
              <span className="v">{nombre(abo.organisations.length, locale)}</span>
              <IcChevron />
            </Link>
            <Link to="/pme/reglages" search={{ page: "utilisateurs" }} className="it">
              <span className="ic am" aria-hidden>
                <IcPersonnes />
              </span>
              <span className="t">
                <b>{t("pme.reglages.sieges")}</b>
                <span>{t("pme.reglages.abo.siegesOccupes")}</span>
              </span>
              <span className="v">
                {nombre(f?.sieges_occupes, locale)} / {nombre(f?.sieges_inclus, locale)}
              </span>
              <IcChevron />
            </Link>
          </div>
        </>
      ) : null}

      {page === "abonnement" && COMMERCE ? (
        <>
          {/* ─────────────────────────────────────────────── l'abonnement */}
          {/* « Mon abonnement » s'ouvre ici depuis l'accueil (`#mon-abonnement`). */}
          <div className="sec" id="mon-abonnement">
            <h2>
              {t("pme.reglages.abo")}
              <Aide
                titre={t("pme.reglages.abo")}
                paragraphes={[
                  { texte: t("pme.reglages.abo.sous") },
                  ...(COMMERCE ? [{ texte: t("pme.reglages.abo.facture") }] : []),
                ]}
              />
            </h2>
          </div>
          {/*
           * L'offre en cours, en carte de tête (maquette du 1er novembre 2026) :
           * son nom en grand, son état en pastille, le prix et ce qu'il comprend.
           */}
          <div className="card abo hero">
            <div className="kick">
              {/* Plusieurs sociétés : la carte dit de laquelle est cette offre. */}
              <u>
                {pme.dossiers.length > 1
                  ? `${t("pme.reglages.abo.kicker")} · ${pme.orgName}`
                  : t("pme.reglages.abo.kicker")}
              </u>
              {f?.statut ? (
                <span className={cn("pill", f.statut !== "active" && "am")}>
                  <i aria-hidden />
                  {etatDeLicence(f.statut, t)}
                </span>
              ) : null}
            </div>
            <div className="nm">
              <b>{f?.offre ? libelleDOffre(catalogue, f.offre) : ABSENT}</b>
              {COMMERCE ? (
                <span className="px">
                  {f?.prix_mensuel_ht ? aLEchelle(f.prix_mensuel_ht) : ABSENT}
                  <small>{t("pme.reglages.abo.parMois", { devise: pme.currency })}</small>
                </span>
              ) : null}
            </div>
            {COMMERCE ? <TtcEtReport ht={f?.prix_mensuel_ht ?? null} /> : null}

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
              {/* Ce qui reste à payer, juste sous l'offre : c'est le geste qui attend. */}
              <ARegler />
              <div className="sec">
                <h2>
                  {t("pme.reglages.offres")}
                  <Aide
                    titre={t("pme.reglages.offres")}
                    paragraphes={[{ texte: t("pme.reglages.offres.sous") }]}
                  />
                </h2>
              </div>
              <ChangerDOffre />
              <PayerALAnnee />
              <MesFactures />

              <div className="sec">
                <h2>
                  {t("pme.reglages.recharges")}
                  <Aide
                    titre={t("pme.reglages.recharges")}
                    paragraphes={[{ texte: t("pme.reglages.recharges.sous") }]}
                  />
                </h2>
              </div>
              <MesRecharges />
            </>
          ) : null}
        </>
      ) : null}

      {page === "societes" ? (
        <>
          {/* ───────────────────────────────────────────── les organisations */}
          <div className="sec">
            <h2>
              {t("pme.reglages.orgs")}
              <Aide
                titre={t("pme.reglages.orgs")}
                paragraphes={[
                  {
                    texte: `${t("pme.reglages.org.matricule")} ${t("pme.reglages.org.matricule.fort")}`,
                  },
                  { texte: t("pme.reglages.orgs.ajouter.sous") },
                ]}
              />
            </h2>
            {/*
             * « n sur m » ne vaut que pour UNE licence : avec des sociétés sur
             * plusieurs licences, « 2 sur 1 » mêlait la mienne et celle d'un autre
             * titulaire (staging, 3 novembre 2026). Le nombre seul, alors.
             */}
            <span>
              {[...abo.titulaire.values()].every(Boolean)
                ? t("pme.reglages.surTotal", {
                    n: abo.organisations.length,
                    total: nombre(f?.organisations, locale),
                  })
                : nombre(abo.organisations.length, locale)}
            </span>
          </div>
          <ListeDesSocietes
            organisations={abo.organisations}
            titulaire={abo.titulaire}
            fiches={fiches.data ?? null}
          />
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
                  {/* Le prix est lu dans la grille, et dit au web et à la PWA seulement. */}
                  {prixEnPlus.data && Number(prixEnPlus.data.prix_organisation_sup) > 0 ? (
                    <span>
                      {t("pme.reglages.orgs.prix", {
                        inclus: String(prixEnPlus.data.organisations_incluses),
                        prix: aLEchelle(prixEnPlus.data.prix_organisation_sup),
                        devise: pme.currency,
                      })}
                    </span>
                  ) : null}
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
        </>
      ) : null}

      {page === "utilisateurs" ? (
        <>
          {/* ───────────────────────────────────────────────────── les sièges */}
          <div className="sec">
            <h2>
              {t("pme.reglages.sieges")}
              <Aide
                titre={t("pme.reglages.sieges")}
                paragraphes={[
                  { texte: t("pme.reglages.sieges.sous") },
                  { texte: t("pme.membres.roles.aide") },
                  { texte: t("pme.membres.lede") },
                ]}
              />
            </h2>
            {/* Le même compte que la ligne de l'abonnement : occupés sur inclus. */}
            <span>
              {nombre(f?.sieges_occupes, locale)} / {nombre(f?.sieges_inclus, locale)}
            </span>
          </div>
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
              {/* Dans l'application Android, la base n'offre que les places
              incluses (`facturation.place_offrir`, 20261023120000) : une place
              qui serait facturée est un achat, et reste au web et à la PWA. */}
              <InviterDansMonDossier
                occupes={f?.sieges_occupes == null ? null : Number(f.sieges_occupes)}
              />
              <MesProprietaires />
            </>
          ) : null}
        </>
      ) : null}

      {!page ? (
        <>
          {/* ──────────────────────── la fiche, les alertes, les échéances */}
          <div className="sec">
            <h2>
              {t("fiche.titre")}
              <Aide
                titre={t("fiche.titre")}
                paragraphes={[
                  { titre: t("fiche.champ.imposition"), texte: t("fiche.sous") },
                  { titre: t("pme.nav.notifs"), texte: t("pme.reglages.alertes.sous") },
                  { titre: t("pme.nav.echeances"), texte: t("pme.reglages.echeances.sous") },
                ]}
              />
            </h2>
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
              </span>
              <IcChevron />
            </Link>
            <Link to="/pme/echeances" className="rw">
              <span className="bd">
                <b>{t("pme.nav.echeances")}</b>
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
            <h2>
              {t("pme.reglages.apparence")}
              <Aide
                titre={t("pme.reglages.apparence")}
                paragraphes={[{ texte: t("pme.reglages.apparence.note") }]}
              />
            </h2>
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
          {/* Planche 5 (7 novembre 2026) : le côté du « + », pour la main qui tient le téléphone. */}
          <div className="rows">
            <Link to="/pme/bouton-plus" className="rw">
              <span className="bd">
                <b>{t("pme.boutonPlus.titre")}</b>
                <span>
                  {coteDuPlus === "gauche"
                    ? t("pme.boutonPlus.gauche")
                    : t("pme.boutonPlus.droite")}
                </span>
              </span>
              <IcChevron />
            </Link>
          </div>

          {/* ───────────────────────────────────────────────── vos données */}
          <div className="sec">
            <h2>
              {t("pme.reglages.donnees")}
              <Aide
                titre={t("pme.reglages.donnees")}
                paragraphes={[
                  { texte: t("pme.reglages.note") },
                  {
                    titre: t("pme.reglages.donnees.espace"),
                    texte: t("pme.reglages.donnees.espace.sous"),
                  },
                  {
                    titre: t("pme.reglages.donnees.biblio"),
                    texte: t("pme.reglages.donnees.biblio.sous"),
                  },
                  {
                    titre: t("pme.reglages.donnees.conservation"),
                    texte: t("pme.reglages.donnees.conservation.sous"),
                  },
                ]}
              />
            </h2>
          </div>
          <div className="rows">
            <Link to="/pme/coffre" className="rw">
              <span className="bd">
                <b>{t("pme.reglages.donnees.espace")}</b>
              </span>
              <IcChevron />
            </Link>
            <Link to="/pme/list" className="rw">
              <span className="bd">
                <b>{t("pme.reglages.donnees.biblio")}</b>
              </span>
              <IcChevron />
            </Link>
            <div className="rw">
              <span className="bd">
                <b>{t("pme.reglages.donnees.conservation")}</b>
              </span>
              <span className="vl">{t("pme.reglages.donnees.conservation.valeur")}</span>
            </div>
            {/*
             * Le bouton éteint « Changer de forfait » est parti le 19 octobre :
             * l'offre se change pour de bon dans « Changer d'offre », plus haut.
             * Un second geste, mort, au même écran, se lisait « pas encore ».
             */}
          </div>

          {/* ───────────────────────── signaler, les pannes, la version */}
          <div className="sec">
            <h2>
              {t("pme.reglages.signaler")}
              <Aide
                titre={t("pme.reglages.signaler")}
                paragraphes={[{ texte: t("pme.reglages.signaler.sous") }]}
              />
            </h2>
          </div>
          <Signalement />
          <PannesConstatees />

          <div className="sec">
            <h2>{t("pme.reglages.version")}</h2>
          </div>
          <Versions />

          <p className="foot">{t("pme.reglages.pied")}</p>
        </>
      ) : null}
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
  /** Par société : l'appelant est-il titulaire de sa licence ? Absente : pas encore lu. */
  titulaire: ReadonlyMap<string, boolean>;
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

  const acces = useMonAcces(pme.tenantId);

  /*
   * Le forfait ne se redemande pas : le layout l'a lu, sans `tenantId`,
   * puisque la licence appartient à la personne. Cet écran lisait
   * `["mon-forfait", tenantId]` quand l'accueil lisait `["mon-forfait"]` —
   * deux entrées de cache et un aller-retour de trop pour la même donnée.
   */
  const forfait = pme.forfait;

  /*
   * TOUTES LES SOCIÉTÉS, SANS SÉLECTION (3 novembre 2026). Chaque société de
   * la personne est lue pour elle-même (`licence_organisations_de`) : son
   * titulaire voit toute sa licence, un autre propriétaire voit cette
   * société-là. L'union se fait par société, et un siège par société et par
   * personne — un siège n'appartient qu'à une société.
   */
  const ids = pme.dossiers.length > 0 ? pme.dossiers.map((d) => d.id) : [pme.tenantId];
  /*
   * UN APPEL POUR TOUTES (7 novembre 2026). Une requête par société faisait,
   * pour un titulaire de cent sociétés, cent appels qui rendaient chacun la
   * licence entière. L'API lit chaque licence une fois et rend l'union, sans
   * doublon, dans l'ordre des sociétés. Les clés gardent leur préfixe : ce
   * qui invalidait `[CLE_SIEGES]` les rafraîchit toujours.
   */
  const lectures = useQuery({
    queryKey: [CLE_ORGANISATIONS, "societes", ...ids],
    queryFn: () => office().facturation.organisationsDesSocietes(ids),
    retry: false,
  });
  const places = useQuery({
    queryKey: [CLE_SIEGES, "societes", ...ids],
    queryFn: () => office().facturation.siegesDesSocietes(ids),
    retry: false,
  });
  const organisations = {
    data: lectures.data,
    error: lectures.error ?? null,
    isPending: lectures.isPending,
  };
  const sieges = {
    data: places.data,
    error: places.error ?? null,
    isPending: places.isPending,
  };

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
    // Ce que la personne détient : par société, `true` si elle est titulaire
    // de sa licence. Vide tant que la base ne l'a pas dit.
    titulaire: new Map((organisations.data ?? []).map((o) => [o.tenant_id, o.titulaire === true])),
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
 * La liste des sociétés — planche 4, approuvée le 7 novembre 2026.
 *
 * Avant : une grande carte par société, cent treize à faire défiler. Ici :
 * une recherche (nom ou matricule), des filtres (par offre, sans
 * comptabilité), les sociétés de A à Z avec un index pour sauter, et la fiche
 * de la société — la même carte qu'avant — dans une feuille, au toucher.
 *
 * L'offre et le cabinet viennent d'UN appel (`fichesDesSocietes`) ; la carte
 * détaillée ne se lit qu'à l'ouverture de sa feuille.
 */
function ListeDesSocietes({
  organisations,
  titulaire,
  fiches,
}: {
  organisations: ReadonlyArray<{ tenantId: string; nom: string; lectures: number | null }>;
  titulaire: ReadonlyMap<string, boolean>;
  fiches: readonly FicheDeSociete[] | null;
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const catalogue = useCatalogueDesOffres().data;
  const [cherche, setCherche] = useState("");
  const [filtre, setFiltre] = useState<string>("toutes");
  const [ouverte, setOuverte] = useState<string | null>(null);
  const feuille = useRef<HTMLDivElement>(null);
  const fermer = useCallback(() => setOuverte(null), []);
  useSuperposition(ouverte !== null, fermer, feuille);

  const ficheDe = new Map((fiches ?? []).map((f) => [f.tenantId, f]));
  const matriculeDe = new Map(pme.dossiers.map((d) => [d.id, d.matricule ?? null]));
  const offres = new Map<string, number>();
  for (const f of fiches ?? []) if (f.offre) offres.set(f.offre, (offres.get(f.offre) ?? 0) + 1);
  const sansCompta = (fiches ?? []).filter((f) => !f.cabinet).length;

  const q = plier(cherche.trim());
  const retenues = organisations
    .filter((o) => {
      const f = ficheDe.get(o.tenantId);
      if (filtre === "sansCompta" && f?.cabinet) return false;
      if (filtre !== "toutes" && filtre !== "sansCompta" && f?.offre !== filtre) return false;
      if (!q) return true;
      return plier(o.nom).includes(q) || plier(matriculeDe.get(o.tenantId) ?? "").includes(q);
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, locale));
  const lettreDe = (nom: string) => plier(nom).slice(0, 1).toLocaleUpperCase() || "#";
  const groupes = new Map<string, typeof retenues>();
  for (const o of retenues) {
    const l = lettreDe(o.nom);
    groupes.set(l, [...(groupes.get(l) ?? []), o]);
  }
  const org = ouverte ? organisations.find((o) => o.tenantId === ouverte) : undefined;

  return (
    <div className="societes">
      <label className="cherche">
        <svg viewBox="0 0 24 24" className="g" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={cherche}
          placeholder={t("pme.societes.chercher")}
          aria-label={t("pme.societes.chercher")}
          onChange={(e) => setCherche(e.target.value)}
        />
      </label>
      <div className="puces" role="group" aria-label={t("pme.reglages.orgs")}>
        <button
          type="button"
          aria-pressed={filtre === "toutes"}
          onClick={() => setFiltre("toutes")}
        >
          {t("pme.notifs.toutesSocietes")} <i>{nombre(organisations.length, locale)}</i>
        </button>
        {[...offres.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([o, n]) => (
            <button key={o} type="button" aria-pressed={filtre === o} onClick={() => setFiltre(o)}>
              {libelleDOffre(catalogue, o)} <i>{nombre(n, locale)}</i>
            </button>
          ))}
        {sansCompta > 0 ? (
          <button
            type="button"
            aria-pressed={filtre === "sansCompta"}
            onClick={() => setFiltre("sansCompta")}
          >
            {t("pme.reglages.sommaire.sansCompta")} <i>{nombre(sansCompta, locale)}</i>
          </button>
        ) : null}
      </div>
      {retenues.length === 0 ? <p className="t-body">{t("pme.societes.aucune")}</p> : null}
      <div className="az-liste">
        {[...groupes.entries()].map(([l, liste]) => (
          <section key={l} id={`societes-${l}`}>
            <p className="lettre">{l}</p>
            <ul>
              {liste.map((o) => {
                const f = ficheDe.get(o.tenantId);
                return (
                  <li key={o.tenantId}>
                    <button type="button" className="so" onClick={() => setOuverte(o.tenantId)}>
                      <span className="bd">
                        <b>{o.nom}</b>
                        <span>
                          {[
                            matriculeDe.get(o.tenantId),
                            f ? (f.cabinet ?? t("pme.reglages.org.cabinet.aucun")) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {f?.offre ? (
                        <em className={titulaire.get(o.tenantId) ? "acc" : undefined}>
                          {libelleDOffre(catalogue, f.offre)}
                        </em>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {groupes.size > 6 ? (
        <nav className="az" aria-label={t("pme.reglages.sommaire.index")}>
          {[...groupes.keys()].map((l) => (
            <a key={l} href={`#societes-${l}`}>
              {l}
            </a>
          ))}
        </nav>
      ) : null}
      {org
        ? createPortal(
            <div className="rp-voile" onClick={fermer}>
              <div
                ref={feuille}
                className="rp-feuille"
                role="dialog"
                aria-modal="true"
                aria-label={org.nom}
                onClick={(e) => e.stopPropagation()}
              >
                <Organisation org={org} titulaire={titulaire.get(org.tenantId)} />
              </div>
            </div>,
            document.querySelector('[data-surface="pme"]') ?? document.body,
          )
        : null}
    </div>
  );
}

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
  titulaire,
}: {
  org: { tenantId: string; nom: string; lectures: number | null };
  /** Titulaire de la licence de cette société ? `undefined` : pas encore lu. */
  titulaire: boolean | undefined;
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const cabinet = useMonCabinet(org.tenantId);
  const dossier = pme.dossiers.find((d) => d.id === org.tenantId);
  /** Ce que la révocation a fait, dit ici : le bloc du mandat disparaît avec lui. */
  const [revoque, setRevoque] = useState<string | null>(null);
  /*
   * L'offre de CETTE société, sous la clé du layout (`mon-forfait`, id) : la
   * même lecture, pas une seconde vérité. Un propriétaire non titulaire en lit
   * le nom et les lectures, pas le prix (`mon_forfait`, branche du membre).
   */
  const forfait = useQuery({
    queryKey: [CLE_FORFAIT, org.tenantId],
    queryFn: () => office().facturation.monForfait(org.tenantId),
    enabled: dossier !== undefined,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const catalogue = useCatalogueDesOffres().data;

  const matricule = dossier?.matricule ?? null;

  return (
    <div className="card org">
      <div className="hd">
        <b>{org.nom}</b>
        {/* Qui je suis dans cette société : la licence, ou le rôle. */}
        <span className={cn("etat", titulaire ? "ac" : "in")}>
          {titulaire
            ? t("pme.reglages.org.principal")
            : dossier?.role
              ? roleLisible(dossier.role, t)
              : t("pme.reglages.org.surLicence")}
        </span>
      </div>
      <span className="mf">
        <IcCadenas />
        {matricule ?? ABSENT}
      </span>
      {/* L'origine du matricule et son immuabilité : dans le ⓘ de « Sociétés ». */}
      <p className="mn">
        {t("pme.reglages.org.cabinet")}{" "}
        <b>{cabinet.data?.name ?? t("pme.reglages.org.cabinet.aucun")}</b>
      </p>
      {forfait.data?.offre ? (
        <p className="mn">
          {t("pme.reglages.org.offre")} <b>{libelleDOffre(catalogue, forfait.data.offre)}</b>
        </p>
      ) : null}
      <p className="mn">
        {t("pme.reglages.org.lectures")} <b>{nombre(org.lectures ?? undefined, locale)}</b>
      </p>
      {titulaire === false ? (
        <p className="mn">{t("pme.reglages.orgs.autreTitulaire", { societe: org.nom })}</p>
      ) : null}
      {cabinet.data ? <LeMandat tenantId={org.tenantId} onRevoque={setRevoque} /> : null}
      {revoque && !cabinet.data ? (
        <p className="t-body" aria-live="polite">
          {revoque}
        </p>
      ) : null}
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
              date: dateEnLettres(a.effet_du, locale),
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
function LeMandat({
  tenantId,
  onRevoque,
}: {
  tenantId: string;
  /**
   * Le mandat révoqué, dit par la carte de la société : sans mandat, ce bloc
   * disparaît avec son cabinet, et sa phrase de retour avec lui.
   */
  onRevoque: (phrase: string) => void;
}) {
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
      setRevoquer(false);
      setArmee(false);
      onRevoque(t("pme.reglages.org.mandat.revoque"));
      /*
       * TOUT SE RELIT ENSEMBLE (staging, 3 novembre 2026). Les deux lectures
       * se suivaient : la carte gardait « Cabinet : Cabinet Ben Salah » le
       * temps de la première. Le cabinet, le mandat et l'abonnement qu'il
       * couvrait (il s'arrête avec le mandat) se relisent en même temps.
       */
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["mon-mandat", tenantId] }),
        qc.invalidateQueries({ queryKey: cleMonCabinet(tenantId) }),
        qc.invalidateQueries({ queryKey: ["abonnements-pour-moi", tenantId] }),
        qc.invalidateQueries({ queryKey: [CLE_FORFAIT, tenantId] }),
      ]);
    },
    onError: (e: unknown) => {
      setArmee(false);
      setRetour(texteDeLErreur(e, "routes/_authenticated/pme.reglages", t("common.error")));
    },
  });

  const m = mandat.data;

  return (
    <>
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
                    date: dateEnLettres(m.depuis, locale),
                  },
                )
              : t("pme.reglages.org.cabinet.aucun")}
        </p>
      ) : null}

      {revoquer && m?.revocable ? (
        <div className="mt-2">
          {/* Ce que la révocation fait se dit au moment du geste, pas en permanence. */}
          <p className="t-body">{t("pme.reglages.org.revocation")}</p>
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
  const acces = useMonAcces(pme.tenantId);
  const dirigeant = acces.data?.role === "dirigeant";

  const groupes = grouperParOrganisation(abo.sieges);

  return (
    <>
      {groupes.map((g) => (
        <div className="grp" key={g.tenantId}>
          <div className="t">
            <b>{g.organisation}</b>
            {/* Le plafond se lit en tête de section ; ici, qui est là. */}
            <span>{nombre(g.lignes.length, locale)}</span>
          </div>
          {g.lignes.map((s) => (
            <Siege
              key={`${s.tenant_id}:${s.user_id}`}
              siege={s}
              moi={s.user_id === compte.data?.id}
              // Le rôle dans la société du groupe, pas dans le dossier ouvert :
              // les réglages montrent toutes les sociétés (3 novembre 2026).
              // Reprendre une place est l'acte du titulaire de la licence : sur
              // la licence d'un autre, l'écran ne le propose pas (staging, 3
              // novembre 2026 — il le proposait sur le propriétaire principal).
              dirigeant={
                abo.titulaire.get(g.tenantId) === true &&
                ((pme.dossiers.find((d) => d.id === g.tenantId)?.role ?? null) === "dirigeant" ||
                  (g.tenantId === pme.tenantId && dirigeant))
              }
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
        {/* Pas de colonne « Lectures » : `licence_sieges_v` ne les porte pas,
            et un « — » permanent n'informait de rien. */}
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
  const qc = useQueryClient();
  /*
   * « Tout est réglé » (1er novembre 2026) : une marque datée, rien n'est
   * effacé — le journal est en ajout seul (R7). La liste ne montre plus que
   * ce qui arrivera ensuite, et disparaît d'ici tant que rien n'échoue.
   */
  const regler = useMutation({
    mutationFn: () => office().journal.regler(pme.tenantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pannes", pme.tenantId] }),
  });

  if ((pannes.data ?? []).length === 0) return null;

  return (
    <>
      <div className="sec">
        <h2>
          {t("pme.reglages.pannes")}
          <Aide
            titre={t("pme.reglages.pannes")}
            paragraphes={[{ texte: t("pme.reglages.pannes.sous") }]}
          />
        </h2>
      </div>
      <div className="rows">
        {(pannes.data ?? []).map((p) => (
          <div key={p.id} className="rw">
            <span className="bd">
              <b>{direUnRefus(p.message)}</b>
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
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="btn"
          style={{ width: "auto" }}
          disabled={regler.isPending}
          onClick={() => regler.mutate()}
        >
          {t("pme.reglages.pannes.regler")}
        </button>
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
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        rows={2}
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

/** L'état de la licence, dit en mots ; un état inconnu garde son code. */
function etatDeLicence(code: string, t: (k: MessageKey) => string): string {
  if (code === "active") return t("pme.reglages.abo.etat.active");
  if (code === "suspendue") return t("pme.reglages.abo.etat.suspendue");
  if (code === "resiliee") return t("pme.reglages.abo.etat.resiliee");
  return code;
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

function IcCarte() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function IcImmeuble() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <path d="M4 21V5l8-2v18M12 9h8v12" />
    </svg>
  );
}

function IcPersonnes() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
    </svg>
  );
}
