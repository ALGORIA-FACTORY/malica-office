import { sensDuSolde } from "@/lib/sens-du-solde";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import portraitMalica from "@/assets/malica.webp";
import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import {
  attendLaPersonne,
  etatDeLAccueil,
  piecesALire,
  piecesEnEchec,
  raisonCourte,
  statutDeLaPieceLue,
} from "@/lib/lecture";
import { motDuStatut } from "@/lib/statut";
import { statutDuCircuit } from "@malica/socle/statut-d-envoi";
import { issueDeLecture } from "@malica/socle/issue-de-lecture";
import { bienvenueDejaVue } from "@/components/malica/bienvenue";
import { PastilleAEnvoyer } from "@/components/malica/file-locale";
import { MandatsProposes } from "@/components/malica/MandatsProposes";
import { usePme } from "@/components/malica/pme-context";
import { useAccueil } from "@/hooks/use-accueil";
import { libelleDOffre, useCatalogueDesOffres } from "@/hooks/use-offres";
import { useNonAssujetti } from "@/hooks/use-regime-tva";
import { currentPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { nombre } from "@/lib/forfait";
import { jourOuInstant, montant, montantSigne } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import { usePiecesLues } from "@/hooks/use-pieces-lues";
import { useDossiers } from "@/hooks/use-dossiers";
import { useMonCabinet } from "@/hooks/use-mon-cabinet";
import { dansLaPeriodeMontree, dossierDeLaPiece, periodeMontree } from "@/lib/dossiers";
import type { PieceLue } from "@malica/socle/ports/repositories";

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
 * Les noms des offres (« Team », « Premium ») ne se traduisent pas, mais ne
 * s'écrivent pas ici non plus : ils viennent du catalogue (`ref.offres`).
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

/** Combien de cartes une rangée montre : au-delà, « Tout voir ». */
const RANGEE = 8;
/** Combien de pièces récentes, en grille de deux. */
const RECENTES = 4;

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
  const nonAssujetti = useNonAssujetti();
  const periode = currentPeriod();
  const a = useAccueil(periode);
  const navigate = useNavigate();

  /*
   * -------------------------------------- LA BARRE DE QUESTION MÈNE À L'ÉCRAN
   *
   * Elle ouvrait un panneau par-dessus l'accueil, en langue Edition One, et le
   * commentaire de ce fichier l'annonçait : « c'est l'écran converser, qui aura
   * son propre dessin avec la route `pme.malica` ». Il l'a — `pme.malica.tsx`,
   * `data-ecran="chat"`, dessiné dans `malica-chat.html` : son en-tête, les
   * sources citées, le composeur collant, l'escalade au cabinet.
   *
   * Relevé avant de brancher : AUCUN lien du dépôt ne menait à `/pme/malica`.
   * L'écran était enregistré, fini et injoignable — et le panneau qu'il
   * remplace restait le seul chemin vers la conversation. Les deux ensemble,
   * c'étaient deux dessins pour une même chose, ce que R9 interdit.
   *
   * Le crochet `usePanneauMalica` ne disparaît pas : le cabinet continue de
   * s'en servir (`cabinet.tsx`), et c'est sa surface à lui.
   */
  const allerALaConversation = () => void navigate({ to: "/pme/malica" });

  /*
   * L'offre se traite à UN endroit, et cinq gestes y mènent : la chip du haut
   * et les quatre cartes du bas. Un seul raccourci, donc — cinq `navigate`
   * recopiés se seraient désyncé au premier renommage de route.
   */

  /*
   * La pastille à l'initiale de la personne a quitté cet écran : elle est dans
   * la barre d'application du layout, donc sur les quinze écrans et plus
   * seulement ici. Le calcul de l'initiale est monté avec elle, dans
   * `pme.tsx`. Cet écran ne lit plus le compte du tout.
   */

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

  // Le prénom de la personne, pour le salut ; écrit dans les réglages.
  const profil = useQuery({
    queryKey: ["mon-profil"],
    queryFn: () => office().identity.monProfil(),
    staleTime: 10 * 60 * 1000,
  });

  // Qui attend, exactement. « Votre comptable » est une périphrase : le
  // dirigeant connaît son cabinet par son nom, et c'est ce nom qui doit
  // apparaître quand quelque chose lui est retourné.
  const cabinet = useMonCabinet(pme.tenantId);

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

  const mois = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );
  const moisCourant = mois(periode);

  const heure = new Date().getHours();
  /*
   * Le salut porte le prénom quand la personne l'a écrit (Réglages, depuis le
   * 19 octobre 2026 : `identity.profiles.prenom`). Sans prénom, le salut nu —
   * jamais un prénom deviné depuis l'adresse.
   */
  const prenom = profil.data?.prenom ?? null;
  const salut = prenom
    ? t(
        heure < 12
          ? "pme.home.greet.morning.prenom"
          : heure < 18
            ? "pme.home.greet.afternoon.prenom"
            : "pme.home.greet.evening.prenom",
        { prenom },
      )
    : t(
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
  /*
   * Les deux phrases de la carte se dérivent d'UN état (`etatDeLAccueil`).
   * Relevé sur staging le 30 octobre 2026 : « AUDICORP attend 3 précisions »
   * au-dessus de « Tout est en ordre. octobre est bouclé. » — l'une comptait
   * les retours, l'autre seulement les pièces à envoyer.
   */
  const etat = etatDeLAccueil(a);
  const attendent = t("pme.home.voix.attendent", { count: a.enAttente, mois: moisCourant });
  const phrase =
    etat === "vide"
      ? t("pme.home.voix.rien")
      : etat === "en_ordre"
        ? t("pme.home.voix.enOrdre", { mois: moisCourant })
        : attendent;

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
  const aRegler = etat === "a_regler";
  const aVerifier = a.enAttente > 0;
  const titreHero = aRegler ? attendCabinet : phrase;
  // Sous un retour, ce qui reste à envoyer s'il y en a ; jamais « en ordre ».
  const sousHero = aRegler && aVerifier ? attendent : ecartPhrase;

  /*
   * ============================================== LES RANGÉES, LUES DANS LA BASE
   *
   * Une lecture déjà faite ailleurs : `capture.listAvecLecture`, sous la clé
   * de la bibliothèque — toutes les pièces, avec leur type, l'émetteur, la
   * date et le total. Pas `capture.list` : elle s'arrête aux cent dernières,
   * et un dossier perdrait ses pièces les plus anciennes (revue de #80).
   * Les noms des types viennent du référentiel traduit, jamais du code.
   */
  const lues = usePiecesLues();
  const sept = useDossiers();
  // Comme l'écran des échéances : le calendrier se dérive d'abord
  // (idempotent), puis se lit — sinon un compte dont personne n'a encore
  // ouvert ses échéances n'en verrait aucune ici (revue de #80).
  const derivation = useQuery({
    queryKey: ["echeances-derivation", pme.tenantId],
    queryFn: () => office().collab.deriverEcheances([pme.tenantId]),
    staleTime: 60_000,
  });
  const echeances = useQuery({
    queryKey: ["echeances", pme.tenantId],
    queryFn: () => office().collab.echeances([pme.tenantId]),
    enabled: derivation.isFetched,
  });
  const catalogue = useCatalogueDesOffres().data;

  // Une pièce se nomme par son dossier, comme sa carte et sa tuile de capture.
  const nomDuDossier = (p: PieceLue) => sept.parCode(dossierDeLaPiece(p, sept.types))?.libelle;
  const jour = (iso: string) => jourOuInstant(iso, locale);

  // Ce qui attend la personne : ce que Malica a lu et qui reste à envoyer, et
  // ce que le cabinet a renvoyé — les deux comptes de la carte, en pages.
  const lesLues = (lues.data ?? []).filter((p) => p.vis !== "personnel");
  /*
   * À LIRE — ce qui a été pris et attend encore une décision : ni lu, ni gardé
   * pour soi. 24 octobre 2026 : « plus tard » existait, mais rien ne
   * retrouvait ces pièces. Elles restent `personnel` jusqu'à « Pour qui ? »
   * (B6), d'où le filtre sur le statut et non sur la visibilité.
   */
  const aLire = piecesALire(lues.data ?? []);
  /*
   * 24 octobre 2026, Wissem : « rien ne dit que la lecture casse ». Une pièce
   * dont la lecture a échoué se voit ici, en rouge, avec sa raison ; la carte
   * mène à la plus récente, dont la fiche porte les gestes.
   */
  const enEchec = piecesEnEchec(lues.data ?? []);
  const premierEchec = enEchec.at(0) ?? null;
  const raisonDuPremier = premierEchec ? raisonCourte(issueDeLecture(premierEchec)) : null;
  const aTraiter = lesLues
    .filter(attendLaPersonne)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .slice(0, RANGEE);
  const dejaVues = new Set(aTraiter.map((p) => p.id));
  const recentes = lesLues
    .filter((p) => p.status !== "capturee" && !dejaVues.has(p.id))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .slice(0, RECENTES);

  /*
   * SEPT DOSSIERS, TOUJOURS LES MÊMES (maquette validée le 25 octobre 2026).
   *
   * Une carte n'existait que pour un type qui avait des pièces : « Gouvernance »
   * disparaissait dès qu'aucun PV n'était rangé, et sa couleur dépendait de sa
   * place. Désormais chaque dossier du référentiel a sa carte, dans son ordre
   * et sa teinte — vide, elle reste là, dans sa couleur (Wissem, 25 octobre).
   * Elle compte la période qu'elle affiche : le mois en cours, ou l'année pour
   * un PV ou une déclaration.
   */
  const dossiers = sept.dossiers.map((d) => {
    const duDossier = lesLues.filter((p) => dossierDeLaPiece(p, sept.types) === d.code);
    // La période la plus récente qui a des pièces (`periodeMontree`) : le 1er
    // du mois, Achats et Ventes ne se disent plus vides sur un dossier plein.
    const montree = periodeMontree(duDossier, d.periode, periode);
    const pieces = duDossier.filter((p) => dansLaPeriodeMontree(p, montree));
    // Un reçu ou un justificatif n'attend rien : il compte pour fait. Une
    // pièce est faite quand le cabinet l'a prise en charge — la règle de la
    // liste (`statutDeLaPieceLue`), sur les faits du suivi.
    const faites = pieces.filter(
      (p) => p.accompagne || statutDeLaPieceLue(p) === "prise_en_charge",
    ).length;
    return {
      ...d,
      total: pieces.length,
      faites,
      part: pieces.length === 0 ? 0 : Math.round((faites / pieces.length) * 100),
      etiquette: d.periode === "mois" ? mois(montree) : montree,
    };
  });

  // Les prochaines échéances non faites, la plus proche d'abord.
  const aujourdhui = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const prochaines = (echeances.data ?? [])
    .filter((e) => e.status !== "fait")
    .map((e) => ({
      ...e,
      jours: Math.round((Date.parse(`${e.dueDate}T00:00:00Z`) - aujourdhui) / 86_400_000),
    }))
    .sort((x, y) => x.dueDate.localeCompare(y.dueDate))
    .slice(0, RANGEE);

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

      {/*
       * Ce qui reste de la deuxième des cinq formes d'en-tête : RIEN.
       *
       * En sont partis, le 19 octobre 2026, la pastille à l'initiale et les
       * deux chips de porte — « Réglages » et « Changer d'espace ». Les deux
       * premières vivent maintenant dans la barre d'application, qui est
       * rendue ici comme ailleurs ; les redire sur cet écran aurait fait deux
       * fois la même porte à 70 px d'écart. « Changer d'espace » est supprimé.
       *
       * Les chips de dossier sont parties le même soir, et pour la MÊME
       * raison — je les avais gardées en écrivant « sur l'accueil le choix est
       * le geste de l'écran ». Sur un téléphone à une seule société, cela
       * donnait le nom de la société DEUX FOIS, à 120 px d'écart : une fois
       * dans la barre, une fois en pastille verte. Relevé en service, sur
       * « ALGORIA FACTORY SUARL ».
       *
       * La barre d'application porte la société, et elle seule : un nom quand
       * il n'y en a qu'une, un sélecteur dès qu'il y en a deux. Le geste
       * existe toujours, il n'est écrit qu'une fois.
       */}

      <div className="pad">
        {/* Le salut, avec le prénom quand la personne l'a écrit. */}
        <h1>{salut}</h1>

        {/* Juste sous le salut : un échec de lecture se voit avant tout le reste. */}
        {premierEchec ? (
          <div role="status">
            <Link to="/pme/piece/$pieceId" params={{ pieceId: premierEchec.id }} className="echec">
              <span className="ic" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="g">
                  <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M12 7.5v5.5M12 16.5v.5" />
                </svg>
              </span>
              <span className="bd">
                <b>{t("pme.home.echecs.titre", { count: enEchec.length })}</b>
                {raisonDuPremier ? <span>{t(raisonDuPremier)}</span> : null}
              </span>
              <span className="voir">{t("pme.home.echecs.voir")}</span>
            </Link>
          </div>
        ) : null}

        {/*
         * ========================================= L'ACCUEIL « PRINCIPE SPOTIFY »
         *
         * 23 octobre 2026, maquette validée par Wissem (« Go ») : une porte par
         * destination. Onze blocs menaient à six endroits, dont trois à la
         * bibliothèque, trois aux réglages et deux à la TVA. L'ordre validé :
         * le chiffre du mois, ce que Malica a préparé, Malica, les dossiers,
         * les pièces récentes, les échéances, l'abonnement. Les aperçus sont
         * les vraies pages, lues dans la base (`ApercuDePiece`).
         */}

        {/* ── 1. le chiffre du mois ─────────────────────────────────────── */}
        <Link to="/pme/tva" className="mois">
          <span className="k">{t("pme.home.tva.kicker", { month: moisCourant })}</span>
          {nonAssujetti ? (
            <span className="v">
              <b className="t">{t("pme.home.tva.nonAssujetti")}</b>
            </span>
          ) : (
            <>
              <span className="v">
                <b>{a.aReverser === null ? "—" : montant(a.aReverser.replace(/^-/, ""), locale)}</b>
                <u>
                  {a.devise}{" "}
                  {sensDuSolde(a.aReverser) === "inconnu"
                    ? t("pme.tva.soldeInconnu")
                    : sensDuSolde(a.aReverser) === "nul"
                      ? t("pme.tva.soldeNul")
                      : sensDuSolde(a.aReverser) === "du"
                        ? t("pme.home.reverser")
                        : t("pme.home.credit")}
                </u>
              </span>
              <span className="dt">
                <span>
                  {t("pme.tva.col.collectee")}{" "}
                  <b>{a.collectee === null ? "—" : montant(a.collectee, locale)}</b>
                </span>
                <span>
                  {t("pme.tva.col.deductible")}{" "}
                  <b>{a.recuperee === null ? "—" : montant(a.recuperee, locale)}</b>
                </span>
                {/* Une pièce que la TVA ne compte pas se dit : le chiffre est incomplet. */}
                {a.horsDuCalcul > 0 ? (
                  <span>{t("pme.home.tva.horsCalcul", { count: a.horsDuCalcul })}</span>
                ) : null}
              </span>
            </>
          )}
        </Link>
        {/* Les charges, et leur sens : la tuile d'hier, en une ligne sous le chiffre. */}
        <Link to="/pme/charges" className="ligne">
          <b>{t("pme.home.card.charges")}</b>
          <span>
            {a.chargesEcart === null
              ? t("pme.home.charges.sous")
              : a.chargesEcart < 0
                ? t("pme.home.charges.baisse", { pourcent: Math.abs(Math.round(a.chargesEcart)) })
                : t("pme.home.charges.hausse", { pourcent: Math.round(a.chargesEcart) })}
          </span>
          <Chevron className="g ar" />
        </Link>

        {/* ── 2. ce qu'elle a préparé : les vraies pages, qui défilent ──── */}
        {aTraiter.length > 0 ? (
          <>
            <div className="sec">
              <h2>{t("pme.home.prepare")}</h2>
              <Link to="/pme/list" search={{ etat: "a_vous" }}>
                {t("common.toutVoir")} <Chevron className="g fl" />
              </Link>
            </div>
            <div className="rail">
              {aTraiter.map((p) => (
                <Link
                  key={p.id}
                  to="/pme/piece/$pieceId"
                  params={{ pieceId: p.id }}
                  className="doc"
                >
                  <span className="pg">
                    <ApercuDePiece pieceId={p.id} />
                    {/* Le mot du statut, ambre : à envoyer, ou revenue du cabinet. */}
                    <span className="etq">
                      <i />
                      {motDuStatut(statutDuCircuit(p), cabinet.data?.name ?? null, t)}
                    </span>
                  </span>
                  <b>{p.emetteur ?? t("pme.list.sansEmetteur")}</b>
                  <span>
                    {[nomDuDossier(p), jour(p.dateDocument ?? p.createdAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {p.total ? <em>{montant(p.total, locale)}</em> : null}
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {/* ── 3. Malica, au cœur de l'écran ─────────────────────────────── */}
        <div className="hero">
          <span className="amb" aria-hidden="true" />
          {/*
           * Le portrait de Malica, 620 px de côté : le dessin le peint à 134 px,
           * soit 268 px sur un écran à densité 2. La cible tient à moins de
           * 40 Ko en WebP.
           */}
          <span className="por">
            <img src={portraitMalica} alt="Malica" width={620} height={620} />
          </span>
          <span className="in">
            <span className="sig">
              <i />
              {t("malica.chat.her")}
            </span>
            <h3>{titreHero}</h3>
            <p>{sousHero}</p>
            <span className="gestes">
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
              {aLire.length > 0 ? (
                <Link to="/pme/a-lire" className="cta sec2 a-lire">
                  {t("pme.home.aLire.titre")} · {aLire.length}
                </Link>
              ) : null}
              {/* La conversation reste accessible depuis la carte Malica. */}
              <button type="button" className="cta sec2" onClick={allerALaConversation}>
                {t("pme.home.demander")}
              </button>
            </span>
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

        {/* ── 4. vos dossiers : les sept, toujours (`ref.dossiers`) ──────── */}
        {dossiers.length > 0 ? (
          <>
            <div className="sec">
              <h2>{t("pme.home.dossiers")}</h2>
              <Link to="/pme/list" search={{ axe: "dossier" }}>
                {t("pme.home.bibliotheque")} <Chevron className="g fl" />
              </Link>
            </div>
            <div className="rail">
              {dossiers.map((d) => (
                <Link
                  key={d.code}
                  to="/pme/dossier/$type"
                  params={{ type: d.code }}
                  data-teinte={d.teinte}
                  className="poch"
                >
                  <span className="cv">
                    <span className="mo">{d.etiquette}</span>
                    <span className="ini" aria-hidden="true">
                      {d.libelle.slice(0, 1)}
                    </span>
                    <b>{d.libelle}</b>
                    <span className="av">
                      <i style={{ width: `${d.part}%` }} />
                    </span>
                  </span>
                  {d.total === 0 ? (
                    <>
                      <b>{t("pme.home.dossier.aucune")}</b>
                      <span>{t("pme.home.dossier.ajouter")}</span>
                    </>
                  ) : (
                    <>
                      <b>{t("pme.home.dossier.pieces", { count: d.total })}</b>
                      <span>{t("pme.home.dossier.faites", { count: d.faites })}</span>
                    </>
                  )}
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {/* ── 5. récemment lues ─────────────────────────────────────────── */}
        {recentes.length > 0 ? (
          <>
            <div className="sec">
              <h2>{t("pme.home.recentes")}</h2>
              <Link to="/pme/list">
                {t("common.toutVoir")} <Chevron className="g fl" />
              </Link>
            </div>
            <div className="recentes">
              {recentes.map((p) => (
                <Link key={p.id} to="/pme/piece/$pieceId" params={{ pieceId: p.id }}>
                  <ApercuDePiece pieceId={p.id} className="mini" />
                  <span className="bd">
                    <b>{p.emetteur ?? t("pme.list.sansEmetteur")}</b>
                    <span>
                      {p.total ? `${montant(p.total, locale)} ${p.devise ?? a.devise}` : "—"}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {/* ── 6. les échéances ──────────────────────────────────────────── */}
        {prochaines.length > 0 ? (
          <>
            <div className="sec">
              <h2>{t("pme.home.card.echeances")}</h2>
              <Link to="/pme/echeances">
                {t("common.toutVoir")} <Chevron className="g fl" />
              </Link>
            </div>
            <div className="rail">
              {prochaines.map((e) => (
                <Link
                  key={e.id}
                  to="/pme/echeances"
                  className={e.jours < 0 ? "ech ret" : e.jours <= 7 ? "ech pro" : "ech"}
                >
                  <span className="j">{jour(e.dueDate)}</span>
                  <b>{e.label}</b>
                  <span>
                    {e.jours < 0
                      ? t("pme.home.ech.retard")
                      : e.jours === 0
                        ? t("pme.home.ech.aujourdhui")
                        : t("pme.home.ech.dans", { count: e.jours })}
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {/* ── 7. l'abonnement, en une ligne : les trois cartes d'hier ───── */}
        <Link to="/pme/reglages" className="ligne abo">
          <b>{f?.offre ? libelleDOffre(catalogue, f.offre) : "—"}</b>
          <span>
            {t("pme.home.abo.ligne", {
              lues: compte(f?.lectures_consommees),
              droit: compte(f?.lectures_droit),
              occupes: compte(f?.sieges_occupes),
              inclus: compte(f?.sieges_inclus),
            })}
          </span>
          <Chevron className="g ar" />
        </Link>
        {pme.captureError ? (
          <p
            role="alert"
            className="mt-3 border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12px]"
          >
            {pme.captureError}
          </p>
        ) : null}
      </div>
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
