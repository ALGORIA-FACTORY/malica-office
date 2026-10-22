import { createFileRoute, useNavigate } from "@tanstack/react-router";

import portraitMalica from "@/assets/malica.webp";
import { marquerBienvenueVue } from "@/components/malica/bienvenue";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/pme/bienvenue")({
  head: () => ({
    meta: [
      { title: "Votre société — Malica Office" },
      {
        name: "description",
        content: "Votre matricule fiscal, à confirmer avant qu'il ne bouge plus.",
      },
      { property: "og:title", content: "Votre société — Malica Office" },
      {
        property: "og:description",
        content: "Votre matricule fiscal. Vérifiez-le maintenant.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Bienvenue,
});

/**
 * L'absence, dite d'un signe.
 *
 * Trois états et pas deux (`09-la-tache-ui.md`) : la valeur, le vide, et
 * l'absence. Un champ que rien ne sert porte ce trait — il ne porte jamais
 * une valeur de maquette.
 */
const ABSENT = "—";

/** La valeur, ou le trait — une chaîne blanche n'est pas une valeur. */
function ouAbsent(valeur: string | null): string {
  return valeur !== null && valeur.trim().length > 0 ? valeur : ABSENT;
}

/**
 * L'arrivée — le premier écran qu'un dirigeant voit, porté sur le dessin
 * validé (`malica-manquants.html`, vue « arr »).
 *
 * ====================================================== CE QUI A CHANGÉ ICI
 *
 * Cette route portait la présentation en pleine encre — « Je m'appelle
 * Malica », trois promesses, fond noir. Le dessin la remplace par la carte
 * d'identification fiscale : le dirigeant arrive, voit ce que Malica a lu de
 * sa carte, et l'arrête. On remplace le balisage, pas le câblage.
 *
 * ================================================= `.top` EST DEHORS, ET POURQUOI
 *
 * Dans la maquette, `.top` est DEDANS `.pad` — sur les six vues rendues, sans
 * exception. Dans le produit il est dehors, en frère de `.pad`, comme sur
 * `pme.regler`. Ce n'est pas un écart de confort : la feuille donne une
 * gouttière à CHACUN des deux (`[data-surface="pme"] .pad` et les deux
 * déclarations de `.top`, à 1.25rem). Imbriqués, la flèche de retour part à
 * 2.5rem quand la carte part à 1.25rem — le dirigeant verrait sa barre du
 * haut décalée de vingt pixels vers l'intérieur. La feuille n'est pas à
 * nous ; c'est le balisage qui s'aligne sur elle.
 *
 * `.app` n'est pas rendu non plus : la coque et la barre du bas sont tenues
 * par le layout `pme.tsx`, qui pose aussi `data-surface="pme"` sur un
 * ancêtre. Les marges négatives annulent son `px-4 py-5`.
 *
 * ===================================================== ELLE A SON PROPRE `.top`
 *
 * Donc l'en-tête du layout s'efface tout seul, par
 * `.app:has([data-ecran] .top) > header { display: none }`. Rien à ajouter,
 * et surtout rien d'autre : un second en-tête donnerait les deux barres
 * empilées.
 *
 * ============================================ CE QUI N'EST PAS BRANCHÉ, ET POURQUOI
 *
 * Cet écran ne fait AUCUN appel, et c'est voulu : c'est un écran d'accueil,
 * il n'en faisait aucun avant, et on ne lui en ajoute pas. Les deux valeurs
 * qu'il montre descendent du shell, qui les a déjà — `pme.matricule` et
 * `pme.orgName` ne coûtent pas une requête.
 *
 * - « Adresse du siège » : rien ne la sert. Le contexte PME ne la porte pas,
 *   et la lire voudrait `identite.ficheCourante` — un appel. Le champ dit
 *   donc `—`, et la rangée reste : elle mène à l'écran qui l'écrira.
 * - « créer la société » ne crée rien ici, et ne peut pas : le dossier est
 *   déjà ouvert AVANT que cet écran ne s'affiche — c'est son `tenantId` et
 *   son `orgName` qui remplissent la carte qu'on voit. `identite.
 *   createOrganization` et `identite.ouvrirDossier` sont au contrat, mais
 *   les appeler ici créerait un doublon du dossier courant. Le geste garde
 *   donc ce qu'il faisait : il acquitte l'arrivée et entre dans le produit,
 *   l'obturateur ouvert.
 * - « Corriger · saisie au clavier » mène à `pme.fiche`, le seul écran qui
 *   écrit ces champs (`identite.etablirFiche`) et qui accepte la frappe.
 *   Naviguer n'est pas appeler : rien n'est ajouté au câblage.
 * - Les quatre forfaits rendent cette vue à l'octet près (2507 pour les
 *   quatre, mesuré). Aucun bloc conditionnel d'abonnement n'est donc écrit.
 *
 * ==================================================== ET ELLE NE REVIENT PAS
 *
 * `pme.index` renvoie ici tant que `dossierNeuf && !bienvenueDejaVue()`. Les
 * TROIS sorties — la flèche, « c'est exact », « corriger » — marquent donc
 * l'arrivée vue. Sans cela l'écran serait un écran dont on ne peut pas
 * sortir : on en part, et l'accueil y renvoie aussitôt.
 */
function Bienvenue() {
  const { t } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();

  /** La flèche : on s'en va, et l'arrivée a eu son tour. */
  const plusTard = () => {
    marquerBienvenueVue();
    void navigate({ to: "/pme" });
  };

  /** « C'est exact » : on entre dans le produit, l'obturateur ouvert. */
  const commencer = () => {
    marquerBienvenueVue();
    pme.ouvrirScanner();
    void navigate({ to: "/pme" });
  };

  /** « Corriger » : la fiche, seul écran qui écrit ces champs. */
  const corriger = () => {
    marquerBienvenueVue();
    void navigate({ to: "/pme/fiche" });
  };

  const matricule = ouAbsent(pme.matricule);
  const raison = ouAbsent(pme.orgName);

  return (
    <div
      data-ecran="bienvenue"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      {/* ── la barre du haut ───────────────────────────────────────────── */}
      <div className="top">
        {/* `pme.regler.retour` est « Retour » dans les trois langues, et c'est
            la clé que portent maintenant les DIX `.bk` du produit — la
            bibliothèque, la TVA et le dossier l'ont rejointe le 19 octobre
            2026, quand le retour est passé à une seule forme. */}
        <button type="button" className="bk" aria-label={t("pme.regler.retour")} onClick={plusTard}>
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.bienvenue.barre")}</span>
      </div>

      <div className="pad">
        {/*
         * La carte, dessinée. `aria-hidden` : c'est la DÉPICTION d'un carton,
         * et ce qu'elle porte est redit juste dessous, en rangées étiquetées.
         * Lue par une synthèse, elle dirait deux fois le même matricule sans
         * dire ce qu'il est.
         */}
        <div className="carte" aria-hidden>
          <span className="ban" />
          <span className="t">{t("pme.bienvenue.carteBandeau")}</span>
          <span className="mf">{matricule}</span>
          <span className="nm">{raison}</span>
          <span className="ln" style={{ top: "74%", width: "44%" }} />
          <span className="ln" style={{ top: "84%", width: "30%" }} />
          <span className="sc" />
        </div>

        {/* ── elle se nomme, puis elle dit ce qu'elle a fait ──────────── */}
        <div className="sgn">
          <span className="ph">
            <img src={portraitMalica} alt="Malica" width={620} height={620} />
          </span>
          <b>{t("malica.chat.her")}</b>
        </div>
        <div className="dit">
          {t("pme.bienvenue.ditTitre")}
          <em>{t("pme.bienvenue.ditSous")}</em>
        </div>

        {/* ── les trois champs lus, chacun corrigeable ────────────────── */}
        <div className="sec">
          <h2>{t("pme.bienvenue.barre")}</h2>
          <span>{t("pme.bienvenue.secEtat")}</span>
        </div>

        <button type="button" className="rw" onClick={corriger}>
          <i aria-hidden>
            <IconeCarte />
          </i>
          <span className="bd">
            <b>{matricule}</b>
            <span>{t("pme.recu.matricule")}</span>
          </span>
        </button>

        <button type="button" className="rw" onClick={corriger}>
          <i aria-hidden>
            <IconePiece />
          </i>
          <span className="bd">
            <b>{raison}</b>
            <span>{t("onboarding.name")}</span>
          </span>
        </button>

        {/* Rien ne sert l'adresse du siège : le trait, pas une valeur. */}
        <button type="button" className="rw" onClick={corriger}>
          <i aria-hidden>
            <IconeSiege />
          </i>
          <span className="bd">
            <b>{ABSENT}</b>
            <span>{t("pme.bienvenue.champAdresse")}</span>
          </span>
        </button>

        <div className="regle">
          <IconeInfo />
          <span>{t("pme.bienvenue.regle")}</span>
        </div>

        {/* ── les deux départs ───────────────────────────────────────── */}
        <div className="go">
          <button type="button" className="pr" onClick={commencer}>
            {t("pme.bienvenue.exact")}
          </button>
          <button type="button" className="sc2" onClick={corriger}>
            {t("pme.bienvenue.corriger")}
          </button>
        </div>

        <p className="foot">{t("pme.bienvenue.pied")}</p>
      </div>
    </div>
  );
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de la vue rendue. Ils portent `class="g"`, la seule
 * règle d'icône commune aux dix écrans : `stroke:currentColor`, `fill:none`,
 * bouts arrondis. La taille vient toujours du contexte (`.rw i svg`,
 * `.regle svg`), jamais de l'icône.
 */

/** Le carton d'identification : un rectangle, un portrait, deux lignes. */
function IconeCarte() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <circle cx="8.5" cy="11" r="2.2" />
      <path d="M5 16a3.6 3.6 0 0 1 7 0M14.5 10h4M14.5 13.5h4" />
    </svg>
  );
}

/** Une pièce — la feuille au coin plié. Ici, la raison sociale. */
function IconePiece() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6" />
    </svg>
  );
}

/** Le siège — un toit et une porte. */
function IconeSiege() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M4 11.5L12 4.5l8 7V20H4z" />
      <path d="M10 20v-5h4v5" />
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
