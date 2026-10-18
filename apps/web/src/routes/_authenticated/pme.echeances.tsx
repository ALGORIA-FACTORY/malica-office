import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/echeances")({
  head: () => ({
    meta: [
      { title: "Vos échéances — Malica Office" },
      {
        name: "description",
        content: "Les dates qui viennent, annoncées à l'avance, jamais à la dernière minute.",
      },
      { property: "og:title", content: "Vos échéances — Malica Office" },
      {
        property: "og:description",
        content: "Les dates qui viennent, annoncées à l'avance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeEcheances,
});

const JOUR_MS = 86_400_000;
const OU = "routes/_authenticated/pme.echeances";

/* ===========================================================================
 *
 *   LES TROIS TRANCHES DU DESSIN — DES BORNES DE LECTURE, PAS DES DÉLAIS
 *
 * Le dessin groupe la liste en trois : « Cette semaine », « Ce mois »,
 * « À venir ». Ces deux bornes sont ce découpage, et rien d'autre : un
 * regroupement d'affichage.
 *
 * Elles ne sont PAS des constantes réglementaires, et la règle R4 n'est donc
 * pas ouverte ici : aucune date d'échéance, aucun délai légal, aucun taux
 * n'est écrit dans ce fichier. Chaque date affichée vient de `dueDate`, que la
 * base dérive du pack de juridiction en vigueur — c'est ce que dit la règle
 * sous le chiffre, et c'est vérifiable. Les dates de la maquette
 * (« 20 oct », « 28 oct », « 15 novembre ») ne sont pas recopiées.
 */
const BORNE_SEMAINE = 7;
const BORNE_MOIS = 30;

/* ===========================================================================
 *
 *   LES CHAÎNES NOUVELLES — UN SEUL BLOC, ET C'EST UNE DETTE NOMMÉE
 *
 * Même convention que `pme.regler` : ce que le dessin apporte et que le
 * dictionnaire ne porte pas encore est ici, en français seulement, en un seul
 * endroit — à vider dans `i18n/` sous les clés `pme.echeances.*` dès que les
 * trois langues peuvent être écrites ensemble.
 *
 * Tout le reste de l'écran lit `t()`. Les clés `pme.echeances.title`,
 * `.voice.*`, `.sous.*`, `.reglee`, `.empty`, `.source`, `.fiche.*`,
 * `.pack.absent` existent dans les trois langues et ne sont pas touchées : on
 * remplace le balisage, pas le câblage, et on ne réécrit pas un libellé déjà
 * traduit.
 */
const MOTS = {
  /** Le titre du dessin. La barre, elle, garde `pme.echeances.title`. */
  titre: "Ce qui tombe",
  /**
   * Le `<u>` sous le grand chiffre. Le dessin y écrit « TND · 30 jours »
   * parce qu'il somme des dinars ; `Echeance` n'en porte aucun (voir le bloc
   * « CE QUI N'EST PAS SERVI »). Le sous-titre dit donc l'absence au
   * dirigeant, dans ses mots, au lieu de donner une unité à un `—`.
   */
  sansMontant: "Les montants ne me sont pas encore remontés",
  semaine: "Cette semaine",
  mois: "Ce mois",
  aVenir: "À venir",
  /** La carte du bas, quand une ligne est dépassée. */
  retardTitre: "Une échéance est dépassée.",
  retardTexte:
    "Je ne l'ai pas vue passer parce que personne ne me l'a dit : aucune pièce de paiement n'est arrivée. Si vous l'avez réglée, photographiez l'avis et je rapprocherai la ligne.",
  retardGeste: "Photographier l'avis",
  /** Le geste de la carte « fiche » — la route existe, le lien ne change pas. */
  ficheGeste: "Compléter la fiche",
} as const;

/**
 * Vos échéances — le dessin validé (`livraison/ecrans/malica-manquants.html`,
 * écran « Échéances »), porté sur la route qui portait déjà le calendrier.
 *
 * ========================================================= ANTICIPÉ, NON ANXIOGÈNE
 *
 * C'est la note du prototype, et elle commande encore la page : une échéance
 * n'est pas une alarme. Elle s'annonce, elle se prépare, et Malica dit combien
 * de temps il reste plutôt que de crier qu'il n'en reste plus.
 *
 * D'où l'ordre, inchangé : sa phrase D'ABORD — ici dans la tranche `.trd`,
 * juste sous le chiffre — la liste ensuite. Un écran qui ouvre sur une date en
 * rouge fait fermer l'application. La tranche ne prend `.am` que si quelque
 * chose est vraiment dépassé ; sinon elle reste à l'accent calme.
 *
 * ================================================ LE CSS EXISTE, ON NE L'ÉCRIT PAS
 *
 * `styles-pme.css` porte les règles du dessin sous
 * `[data-surface="pme"] [data-famille="papiers"]` — 126 règles, et c'est le
 * marqueur de famille qui les fait descendre. L'écran pose donc les DEUX
 * marqueurs : `data-famille="papiers"` pour les règles, `data-ecran="echeances"`
 * pour l'identité que l'audit recense.
 *
 * `data-ecran="echeances"` n'a aucune règle propre dans la feuille, et c'est
 * normal : tout vient de la famille. Son autre rôle est l'en-tête unique —
 * `.app:has([data-ecran] .top) > header{display:none}`. Cet écran rend son
 * `.top` (le dessin en a un), donc l'en-tête du layout s'efface tout seul. On
 * n'en ajoute pas un second.
 *
 * Classes employées, toutes relevées dans la feuille avant usage :
 * `.top .bk .ttl .ic`, `h1`, `.chiffre` + `u`, `.trd` + `.am`, `.regle`,
 * `.sec` + `h2` + `span`, `.rw` + `i` + `.am` + `.ve` + `.bd` + `b` + `span`
 * + `.acc` + `.rt` + `.vl` + `.dt`, `.card` + `p` + `.b` + `button.sec`, plus
 * `.pad` et `.g` qui sont au niveau de la surface. Aucune classe Tailwind sur
 * ces éléments : la seule exception est la racine, et ses `-mx-4 -my-5`
 * n'annulent que le `px-4 py-5` du `<main>` du layout.
 *
 * `.app` et `.nav` ne sont pas rendus — la coque et la barre du bas sont
 * tenues par le layout `pme.tsx`, une fois pour tous les écrans, et c'est lui
 * aussi qui pose `data-surface="pme"`. La rangée « Basic · Solo · Team ·
 * Premium » du dessin est une affordance de maquette : les quatre forfaits
 * rendent cet écran à l'octet près (4 611 o, même empreinte), il n'y a donc
 * aucun bloc conditionnel d'abonnement à écrire.
 *
 * =================================================== `.sec` VEUT DIRE DEUX CHOSES
 *
 * Dans cette feuille, `.sec` est à la fois le titre de section
 * (`.sec:not(button)`) et le bouton secondaire (`.card .b button.sec`). La
 * garde est `:not(button)` SEULE — pas `:not(button):not(a)`. Un `<a class="sec">`
 * recevrait donc les 28 px de marge et le `display:flex` du titre de section.
 * Le bouton secondaire de la carte est pour cette raison un vrai `<button>`
 * qui navigue, jamais un `<Link>`.
 *
 * ===================================== LES LIGNES SE LISENT, ELLES NE CLIQUENT PAS
 *
 * Le dessin fait de chaque ligne un `<button class="rw">`. Aucune route ne
 * mène à une échéance : il n'y a pas de `pme.echeance.$id`, et aucune méthode
 * du contrat n'en rend une seule. Les lignes sont donc des `<div class="rw">`,
 * comme sur `pme.regler` — un bouton qui ne mène nulle part est pire qu'une
 * ligne qui se lit. Elles redeviendront des boutons avec la route.
 *
 * ============================================= CE QUI N'EST PAS SERVI, ET POURQUOI
 *
 * - **Les montants.** `Echeance` (`packages/socle/src/ports/repositories.ts`)
 *   rend `{id, tenantId, kind, label, period, dueDate, status, faitLe, regle,
 *   texteSource, article, periodicite}`. Aucun montant. Le grand chiffre du
 *   dessin (« 4 286,000 »), le « Dont 1 486,000 cette semaine », les totaux de
 *   section (« 3 · 1 486,000 ») et chaque `.vl` de ligne affichent donc `—`.
 *   Les sections ne gardent que leur compte, qui est vrai. Un montant recopié
 *   de la maquette serait une faute, pas un exemple.
 * - **Les lignes fournisseur.** Le dessin mêle du fiscal (acompte, TVA, CNSS)
 *   et des pièces (« Ateliers Medina — solde », « Papeterie Centrale »,
 *   « SOTUMAG — solde à encaisser », « Traite BH »). `collab.echeances` ne rend
 *   que ce que la dérivation tire du pack : des obligations. Ces lignes-là ne
 *   sont pas inventées, et les deux signes du dessin qui les distinguaient (la
 *   feuille, la banque) ne sont pas rendus — toutes les lignes portent le signe
 *   de l'obligation, parce qu'elles en sont toutes une.
 * - **« Une pièce marquée “pas encore payé” arrive ici toute seule. »** La
 *   phrase de la règle promet un canal qui n'existe pas : rien ne remonte une
 *   pièce impayée dans ce calendrier. La règle ne garde donc que sa seconde
 *   moitié, qui est vraie et déjà traduite : `pme.echeances.source`.
 * - **« Je ne l'ai pas payé ».** Le second bouton de la carte voudrait
 *   `collab.marquerEcheance(id, false)`. La méthode est au contrat, mais cette
 *   route ne l'appelle pas aujourd'hui et on rhabille sans recâbler. Le bouton
 *   n'est pas rendu ; son geste reste à brancher.
 */
function PmeEcheances() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();

  // Le calendrier se dérive du pack à l'ouverture — idempotent — puis se lit.
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
  const raison = derivation.data?.[0]?.raison ?? null;

  const rows = echeances.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  // Le retard se constate en base, à la dérivation : l'écran le lit, il ne le recalcule pas.
  const enRetard = rows.filter((e) => e.status === "en_retard");
  const prochaine = rows.find((e) => e.status === "a_venir") ?? null;
  const echec = derivation.error ?? echeances.error ?? null;

  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  const jours = (iso: string) =>
    Math.round(
      (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / JOUR_MS,
    );

  const phrase =
    rows.length === 0
      ? t("pme.echeances.voice.empty")
      : enRetard.length > 0
        ? t("pme.echeances.voice.late", { count: enRetard.length })
        : prochaine
          ? t("pme.echeances.voice.next", {
              label: prochaine.label,
              days: jours(prochaine.dueDate),
            })
          : t("pme.echeances.voice.empty");

  /*
   * Les trois tranches du dessin. Une tranche vide ne s'affiche pas : un titre
   * de section suivi de rien ferait croire à une perte.
   */
  const tranches = [
    {
      titre: MOTS.semaine,
      lignes: rows.filter((e) => jours(e.dueDate) <= BORNE_SEMAINE),
    },
    {
      titre: MOTS.mois,
      lignes: rows.filter(
        (e) => jours(e.dueDate) > BORNE_SEMAINE && jours(e.dueDate) <= BORNE_MOIS,
      ),
    },
    {
      titre: MOTS.aVenir,
      lignes: rows.filter((e) => jours(e.dueDate) > BORNE_MOIS),
    },
  ].filter((tr) => tr.lignes.length > 0);

  return (
    <div
      data-ecran="echeances"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      {/* ── la barre du haut ───────────────────────────────────────────── */}
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme" })}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.echeances.title")}</span>
        <span className="ic" aria-hidden>
          <IconeCalendrier />
        </span>
      </div>

      <div className="pad">
        <h1>{MOTS.titre}</h1>

        {/*
         * Le grand chiffre du dessin somme des dinars. Aucun montant n'est au
         * contrat : le chiffre est un `—` assumé, et le `<u>` le nomme.
         */}
        <div className="chiffre">
          —<u>{MOTS.sansMontant}</u>
        </div>

        {/* Sa parole, dans la tranche. `.am` seulement si c'est vraiment dépassé. */}
        <div className={enRetard.length > 0 ? "trd am" : "trd"}>
          <i aria-hidden />
          {phrase}
        </div>

        {/*
         * La règle, réduite à ce qui est vrai : les dates viennent du pack, pas
         * des pièces. C'est `pme.echeances.source`, déjà traduite.
         */}
        <p className="regle">
          <IconeInfo />
          <span>{t("pme.echeances.source")}</span>
        </p>

        {echec ? (
          <div className="card" role="alert">
            <p>{texteDeLErreur(echec, OU, t("common.error"))}</p>
          </div>
        ) : null}

        {raison === "fiche.absente" || raison === "fiche.incomplete" ? (
          <div className="card">
            <p>
              {t(
                raison === "fiche.absente"
                  ? "pme.echeances.fiche.absente"
                  : "pme.echeances.fiche.incomplete",
              )}
            </p>
            <div className="b">
              <button type="button" onClick={() => void navigate({ to: "/pme/fiche" })}>
                {MOTS.ficheGeste}
              </button>
            </div>
          </div>
        ) : raison === "pack.absent" ? (
          <div className="card" role="alert">
            <p>{t("pme.echeances.pack.absent")}</p>
          </div>
        ) : null}

        {echeances.isPending && !echec ? (
          <p className="regle">
            <span>{t("common.loading")}</span>
          </p>
        ) : rows.length === 0 ? (
          <div className="card">
            <p>{t("pme.echeances.empty")}</p>
          </div>
        ) : (
          tranches.map((tr) => (
            <div key={tr.titre}>
              <div className="sec">
                <h2>{tr.titre}</h2>
                {/* Le compte, et lui seul : le total en dinars n'est pas servi. */}
                <span>{tr.lignes.length}</span>
              </div>
              {tr.lignes.map((e) => {
                const retard = e.status === "en_retard";
                const deposee = e.status === "fait";
                const reste = jours(e.dueDate);
                const ton = deposee ? "acc" : retard ? "ve" : reste <= BORNE_SEMAINE ? "am" : "";
                return (
                  <div className="rw" key={e.id}>
                    <i className={ton === "acc" ? undefined : ton || undefined}>
                      <IconeObligation />
                    </i>
                    <span className="bd">
                      <b>{e.label}</b>
                      <span className={ton || undefined}>
                        {deposee
                          ? t("pme.echeances.sous.deposee")
                          : retard
                            ? t("pme.echeances.sous.retard", { count: Math.abs(reste) })
                            : t("pme.echeances.sous.avenir", { count: reste })}
                      </span>
                    </span>
                    <span className="rt">
                      {/*
                       * `.vl` porte le montant dans le dessin. Faute de
                       * montant : `—`, ou l'état quand il y en a un à dire.
                       */}
                      <span className="vl">{deposee ? t("pme.echeances.reglee") : "—"}</span>
                      <span className="dt">{jour(e.dueDate)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}

        {/*
         * La carte du bas du dessin. Elle ne paraît que s'il y a vraiment un
         * retard — sinon elle inquiéterait pour rien, et l'écran est « non
         * anxiogène ». Son geste principal mène à la capture, qui existe ; le
         * « Je ne l'ai pas payé » du dessin attend `collab.marquerEcheance`.
         */}
        {enRetard.length > 0 ? (
          <div className="card" style={{ marginTop: "1.25rem" }}>
            <p>
              <b style={{ color: "var(--tx)" }}>{MOTS.retardTitre}</b> {MOTS.retardTexte}
            </p>
            <div className="b">
              <button type="button" onClick={() => void navigate({ to: "/pme/capturer" })}>
                {MOTS.retardGeste}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de `malica-manquants.html`. Ils portent `class="g"`,
 * la règle d'icône commune à la surface : `stroke:currentColor`, `fill:none`,
 * bouts arrondis. La taille vient toujours du contexte (`.top .ic svg`,
 * `.rw i svg`, `.regle svg`), jamais de l'icône.
 */

/** Le calendrier — le signe de la barre du haut. */
function IconeCalendrier() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

/**
 * L'obligation — les barres. Le dessin alternait trois signes (barres,
 * feuille, banque) pour trois origines ; `collab.echeances` n'en rend qu'une,
 * l'obligation dérivée du pack. Un seul signe, donc, et il est honnête.
 */
function IconeObligation() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V7M17 16v-6" />
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
