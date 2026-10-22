import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useId, useState } from "react";

import portraitMalica from "@/assets/malica.webp";
import { files } from "@/capabilities/files";
import { usePme } from "@/components/malica/pme-context";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type { RegimeDisponible } from "@malica/socle/ports/repositories";

const CameraScanner = lazy(() =>
  import("@/components/malica/CameraScanner").then((m) => ({ default: m.CameraScanner })),
);

export const Route = createFileRoute("/_authenticated/pme/fiche")({
  head: () => ({
    meta: [
      { title: "Votre situation fiscale — Malica Office" },
      {
        name: "description",
        content:
          "Le régime, l'assujettissement à la TVA et l'exercice du dossier, lus sur la carte d'identification fiscale et confirmés par vous.",
      },
      { property: "og:title", content: "Votre situation fiscale — Malica Office" },
      {
        property: "og:description",
        content: "Photographiez votre carte : je lis, vous confirmez.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FicheFiscale,
});

const OU = "routes/_authenticated/pme.fiche";

/**
 * La situation fiscale du dossier — lue sur la carte, arrêtée par la personne.
 *
 * ============================================================ POURQUOI CET ÉCRAN
 *
 * Sans lui, Malica ignore si le dossier est assujetti à la TVA et s'il relève
 * du réel. Elle ne peut donc ni qualifier une opération, ni répondre sur une
 * déduction — ses deux issues seraient de supposer en silence, ou d'interroger
 * le client à chaque question.
 *
 * ============================================================ POURQUOI LA CARTE
 *
 * Le référentiel fiscal porte ceci : « Condition d'application du taux 3 % aux
 * personnes physiques : présentation de la CARTE D'IDENTIFICATION FISCALE
 * régime réel » — Article 52-I-a. Le droit tunisien désigne lui-même cette
 * carte comme la preuve du régime. La lire est plus sûr que de la demander :
 * un dirigeant se trompe sur son régime, la carte non.
 *
 * ====================================================== ELLE LIT, VOUS ARRÊTEZ
 *
 * La lecture REMPLIT le formulaire, elle ne l'enregistre pas. Tout reste
 * modifiable, et ce qu'elle n'a pas su lire reste vide au lieu d'être deviné.
 * C'est R10 : Malica propose, l'expert arrête le paramétrage.
 *
 * ================================================= IL N'Y A PAS DE DESSIN DE CET ÉCRAN
 *
 * Mesuré, et c'est le fait central de cette conversion. La maquette
 * `malica-manquants.html` dessine SIX vues — `prive`, `rub`, `ech`, `tva`,
 * `cab`, `arr` — et aucune n'est la fiche. `rub` est le renommage des
 * rubriques, pas l'identité de l'entreprise : la prendre pour elle aurait été
 * une erreur de lecture.
 *
 * On n'invente donc pas un dessin : on EMPLOIE les primitives de la famille,
 * relevées une à une dans `styles-pme.css` sous
 * `[data-surface="pme"] [data-famille="papiers"]`. La fiche est un formulaire,
 * et cette famille en porte déjà le vocabulaire :
 *
 *   `.pan` + `.pan p` + `.pan .champ`      le panneau, sa question, son champ
 *   `.pan .chx` + `button` + `button.on`   un choix parmi plusieurs
 *   `.pan .fixe`                           la mention qui ne bouge pas
 *   `.pan .bil` + `b`                      le bilan de ce qui va être inscrit
 *   `.pan .b` + `button` + `button.sec`    les actions, de poids différents
 *   `.sec:not(button)` + `h2` + `span`     le titre de section et son compteur
 *   `.sgn` + `.dit`                        la voix de Malica
 *   `.mur`                                 une mention d'information
 *   `.card` + `p`                          le mur d'erreur (comme `pme.regler`)
 *   `.go` + `.pr`                          l'engagement, en bas
 *
 * `rub.premium` rendu a servi d'exemple de référence de ce langage en
 * situation ; il n'a pas servi de dessin.
 *
 * ========================================== LES QUATRE ARBITRAGES, FAUTE DE DESSIN
 *
 * 1. UN `.top`, PARCE QUE LES SIX VUES EN ONT UN. Mesure : les six vues
 *    dessinées portent toutes `.top` avec un `.ttl` (« Rubriques », « TVA du
 *    mois », « Votre société »…). La convention de la famille est donc qu'un
 *    écran porte son en-tête. Conséquence assumée, et c'est la règle du dépôt
 *    qui la produit : `.app:has([data-ecran] .top) > header{display:none}`
 *    masque l'en-tête du layout — donc `EntetePme`, le sélecteur de dossier.
 *    `pme.regler` a déjà arbitré ainsi, et c'est validé.
 *
 * 2. `.chx` PARTOUT, JAMAIS `.seg`. La famille offre les deux. `.seg button`
 *    est en `flex:1` : il répartit à parts égales et suppose donc qu'on
 *    connaisse le NOMBRE d'options. Or les options viennent de la base
 *    (`regimesDisponibles`, `formesDisponibles`) : leur cardinalité n'est pas
 *    connue à l'écriture. `.pan .chx` est en `flex-wrap:wrap` et tolère
 *    n'importe quel nombre. Choisir `.seg` aurait été parier sur le
 *    référentiel ; R8 l'interdit. `.seg` reste donc inemployé ici.
 *
 * 3. QUATRE PANNEAUX, PAS HUIT. `.pan .champ` n'a pas de `margin-top` dans la
 *    feuille : il y est dessiné comme PREMIER enfant du panneau (`rub` renomme
 *    une seule chose). Un panneau par champ aurait donné huit `.sec` à
 *    1,0625 rem — un formulaire en titres. On groupe donc par décision : le
 *    régime, la société, l'exercice, l'arrêt.
 *
 * 4. LE POIDS DES DEUX ACTIONS. Photographier AIDE à remplir : c'est le
 *    bouton léger, `.pan .b button.sec`. Enregistrer ENGAGE : c'est `.go .pr`,
 *    le bouton d'engagement de la famille — celui par lequel `arr` crée la
 *    société. Le poids porte le sens. `.go .sc2` reste inemployé : aucune
 *    seconde action de bas de page n'est vraie ici, et `.top .bk` fait déjà
 *    le retour. On ne fabrique pas un bouton pour remplir une primitive.
 *
 * ============================================ LES TROIS TROUS, ET CE QU'ILS ÉTAIENT
 *
 * Cette conversion en a signalé trois. **Deux étaient des artefacts de relevé,
 * un seul était réel** — et les trois sont tranchés dans la feuille, le
 * 18 octobre, avec des valeurs lues et non choisies :
 *
 * - `.foot` n'était PAS absent. `[data-surface="pme"] .foot` est déclaré au
 *   niveau de la surface : il peint les treize écrans. Le relevé le cherchait
 *   sous `[data-famille="papiers"]`, où il n'a effectivement aucune règle — et
 *   en a conclu qu'il était nu. La phrase de clôture reprend donc `.foot`.
 *
 * - L'état éteint n'était PAS absent non plus. La feuille écrit ses états
 *   éteints en SÉLECTEUR D'ATTRIBUT — `.btn[disabled]{opacity:.4}` — jamais en
 *   pseudo-classe `:disabled`. Un relevé cherchant `:disabled` trouve zéro
 *   règle et refait en style en ligne, à la même valeur, ce qui existait.
 *   La famille a maintenant sa propre règle `[disabled]`, au `.4` de la
 *   surface, sur ses quatre primitives de bouton. Les deux `style={ETEINT}`
 *   de ce fichier sont partis avec.
 *
 * - Le champ de saisie, lui, manquait VRAIMENT. `.pan .champ` existe, mais le
 *   dessin ne l'emploie qu'en premier enfant et sur un `<div>` d'affichage,
 *   jamais sur un `<input>` — qui n'hérite ni la police ni la couleur et ne
 *   prend pas la largeur de son conteneur. La feuille porte les deux règles
 *   qui manquaient, avec le `.75rem` de `.pan p` et `.pan .chx`.
 *
 * La leçon, et elle vaut au-delà de cet écran : **un grep trop étroit ressemble
 * à une absence.** Deux fois sur trois ici, le relevé a conclu « 0 règle » là
 * où la règle existait sous une autre forme ou à une autre portée. Chercher
 * une classe sous le seul sélecteur attendu ne dit pas qu'elle n'est pas
 * peinte ailleurs.
 */
function FicheFiscale() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [scanne, setScanne] = useState(false);
  useSuperposition(
    scanne,
    useCallback(() => setScanne(false), []),
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [luDeLaCarte, setLuDeLaCarte] = useState<Set<string>>(new Set());

  const [regimeImposition, setRegimeImposition] = useState("");
  const [regimeTva, setRegimeTva] = useState("");
  const [prorata, setProrata] = useState("");
  const [secteur, setSecteur] = useState("");
  const [debut, setDebut] = useState("");
  const [cloture, setCloture] = useState("");
  const [forme, setForme] = useState("");
  const [mode, setMode] = useState("");

  const regimes = useQuery({
    queryKey: ["regimes", pme.jurisdiction],
    queryFn: () => office().identity.regimesDisponibles(pme.jurisdiction),
  });
  const formes = useQuery({
    queryKey: ["formes", pme.jurisdiction],
    queryFn: () => office().identity.formesDisponibles(pme.jurisdiction),
  });
  // Les codes viennent du référentiel ; leur libellé, du dictionnaire.
  const choixDe = (axe: "forme" | "mode") =>
    (formes.data ?? [])
      .filter((f) => f.axe === axe)
      .map((f) => ({ code: f.code, libelle: libelleDuChoix(axe, f.code, t) }));

  const courante = useQuery({
    queryKey: ["fiche", pme.tenantId],
    queryFn: () => office().identity.ficheCourante(pme.tenantId),
  });

  const parAxe = (axe: RegimeDisponible["axe"]) =>
    (regimes.data ?? []).filter((r) => r.axe === axe);

  /**
   * Le fondement légal du régime choisi, tel que la base le porte.
   *
   * `RegimeDisponible` porte un champ `fondement` que l'écran n'affichait pas.
   * La famille a exactement la primitive pour lui : `.pan .fixe` — mono, petit,
   * sourd, avec un cadenas. C'est la mention qui ne bouge pas. Rien n'est
   * inventé : si la base ne donne pas de fondement, la ligne n'existe pas.
   */
  const fondementDe = (axe: RegimeDisponible["axe"], code: string) =>
    code
      ? ((regimes.data ?? []).find((r) => r.axe === axe && r.code === code)?.fondement ?? null)
      : null;

  /*
   * La fiche en place remplit le formulaire.
   *
   * Sans cela, un expert qui revient sur cet écran voit des champs vides
   * alors qu'une situation EST établie — et l'enregistrer effacerait ce qui y
   * était, puisque la nouvelle fiche clôture l'ancienne. On modifie ce qui
   * existe, on ne repart pas de zéro.
   *
   * Une seule fois : la garde empêche d'écraser ce que la personne vient de
   * saisir à chaque nouvelle réponse du serveur.
   */
  const [seme, setSeme] = useState(false);
  useEffect(() => {
    const f = courante.data;
    if (!f || seme) return;
    setRegimeImposition(f.regimeImposition ?? "");
    setRegimeTva(f.regimeTva ?? "");
    setProrata(f.prorataTva ?? "");
    setSecteur(f.secteur ?? "");
    setDebut(f.debutActivite ?? "");
    setCloture(f.clotureExercice ?? "");
    setForme(f.formeJuridique ?? "");
    setMode(f.modeDepot ?? "");
    setSeme(true);
  }, [courante.data, seme]);

  /** Une image, lue par l'œil, qui remplit le formulaire sans rien décider. */
  const lecture = useMutation({
    // Les octets partent tels quels : l'œil les reçoit par leur propre route,
    // sans passer par une adresse de données de plusieurs mégaoctets.
    mutationFn: (blob: Blob) =>
      office().malica.lireCarte({ jurisdiction: pme.jurisdiction, fichier: blob }),
    onSuccess: (res) => {
      setErreur(null);
      const c = res.carte;
      const lus = new Set<string>();
      // On ne remplit QUE ce qui a été lu. Un champ absent reste vide : c'est
      // une information, pas un trou à combler.
      if (c.regime_imposition) {
        setRegimeImposition(c.regime_imposition);
        lus.add("regime_imposition");
      }
      if (c.regime_tva) {
        setRegimeTva(c.regime_tva);
        lus.add("regime_tva");
      }
      if (c.activite) {
        setSecteur(c.activite);
        lus.add("secteur");
      }
      if (c.debut_activite) {
        setDebut(c.debut_activite);
        lus.add("debut_activite");
      }
      setLuDeLaCarte(lus);
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const enregistrement = useMutation({
    mutationFn: () =>
      office().identity.etablirFiche({
        tenantId: pme.tenantId,
        regimeImposition: regimeImposition || null,
        regimeTva: regimeTva || null,
        prorataTva: regimeTva === PARTIEL && prorata ? Number(prorata) : null,
        secteur: secteur.trim() || null,
        debutActivite: debut || null,
        clotureExercice: cloture || null,
        formeJuridique: forme || null,
        modeDepot: mode || null,
        // La source dit d'où vient la fiche, et elle ne ment pas : « carte »
        // seulement si l'œil a réellement rempli quelque chose.
        source: luDeLaCarte.size > 0 ? ("carte" as const) : ("saisie" as const),
        validFrom: AUJOURDHUI(),
      }),
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["fiche", pme.tenantId] });
      void navigate({ to: "/pme" });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  /*
   * Le bilan, compté — pas estimé.
   *
   * `.pan .bil` est la primitive du « voici ce qui va être inscrit ». Elle a
   * besoin d'un chiffre vrai : on compte les sept champs que `etablirFiche`
   * transporte toujours. Le prorata n'y est pas — il n'existe que pour un
   * assujetti partiel, et un total qui bougerait selon la TVA ne se lirait
   * pas.
   */
  const CHAMPS = [regimeImposition, regimeTva, secteur.trim(), debut, cloture, forme, mode];
  const remplis = CHAMPS.filter((v) => v !== "").length;

  const rien = remplis === 0;
  // Les listes et la fiche viennent de la base ; si elle ne répond pas, on le dit.
  const echecLecture = regimes.error ?? formes.error ?? courante.error ?? null;
  const dateLisible = (iso: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(iso)
      ? new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${iso}T00:00:00Z`))
      : iso;

  const marque = t("fiche.marqueLue");

  return (
    /*
     * Les deux marqueurs. `data-famille="papiers"` fait descendre les 125
     * règles de la famille — sans lui l'écran est nu. `data-ecran="fiche"` est
     * l'identité : c'est lui que l'audit recense, et lui que la règle
     * d'en-tête unique interroge. `data-surface` est posé par le layout
     * `pme.tsx` sur un ancêtre ; on ne le pose jamais ici.
     *
     * Les marges négatives annulent le `px-4 py-5` du `<main>` du layout :
     * `.top` et `.pad` portent leurs propres gouttières, et le dessin ne veut
     * pas de double gouttière.
     */
    <div
      data-ecran="fiche"
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
        <span className="ttl">{t("pme.fiche.barre")}</span>
        <span className="ic" aria-hidden>
          <IconeCarte />
        </span>
      </div>

      <div className="pad">
        <h1>{t("fiche.titre")}</h1>
        {/*
         * Une ligne, pas trois. Quand une situation existe déjà, c'est CELA
         * qu'il faut dire — le formulaire la modifie, il ne repart pas de
         * zéro. Le reste du temps, on explique à quoi sert l'écran.
         */}
        <p className="sub">
          {courante.data
            ? t("fiche.dejaEtablie", { depuis: dateLisible(courante.data.validFrom) })
            : t("fiche.sous")}
        </p>

        {/* ── la voix de Malica ──────────────────────────────────────── */}
        <div className="sgn">
          <span className="ph">
            <img src={portraitMalica} alt="" width={620} height={620} />
          </span>
          <b>{t("malica.chat.her")}</b>
        </div>
        <div className="dit">
          {t("fiche.voix")}
          <em>{t("fiche.promesse")}</em>
        </div>

        {/* ── la lecture de la carte ─────────────────────────────────── */}
        <div className="sec">
          <h2>{t("pme.fiche.secCarte")}</h2>
          <span>
            {luDeLaCarte.size > 0 ? t("pme.bienvenue.secEtat") : t("pme.fiche.cartePasLue")}
          </span>
        </div>
        <div className="pan">
          <p>{t("pme.fiche.panCarte")}</p>
          <div className="b">
            {/*
             * Le bouton léger : photographier AIDE à remplir, il n'engage
             * rien. L'engagement est en bas, en `.go .pr`.
             */}
            <button
              type="button"
              className="sec"
              disabled={lecture.isPending}
              onClick={() => setScanne(true)}
            >
              {lecture.isPending ? t("fiche.lecture") : t("fiche.photographier")}
            </button>
          </div>
        </div>

        {luDeLaCarte.size > 0 ? (
          <div className="mur">
            <IconeInfo />
            <p>{t("fiche.lu", { count: luDeLaCarte.size })}</p>
          </div>
        ) : null}

        {/* Le mur d'erreur, comme `pme.regler` l'a arrêté : `.card` + `p`. */}
        {erreur || echecLecture ? (
          <div className="card" role="alert">
            <p>{erreur ?? texteDeLErreur(echecLecture, OU, t("common.error"))}</p>
          </div>
        ) : null}

        {/* ── le régime ──────────────────────────────────────────────── */}
        <div className="sec">
          <h2>{t("pme.fiche.secRegime")}</h2>
          <span>{t("pme.fiche.duReferentiel")}</span>
        </div>
        <div className="pan">
          <Axe
            label={t("fiche.champ.imposition")}
            options={parAxe("imposition")}
            valeur={regimeImposition}
            onChange={setRegimeImposition}
            vide={t("fiche.nonRenseigne")}
            marque={luDeLaCarte.has("regime_imposition") ? marque : undefined}
          />
          {/* Le fondement du régime choisi, tel que la base le porte. */}
          <Fondement texte={fondementDe("imposition", regimeImposition)} />

          <Axe
            label={t("fiche.champ.tva")}
            options={parAxe("tva")}
            valeur={regimeTva}
            onChange={(v) => {
              setRegimeTva(v);
              if (v !== PARTIEL) setProrata("");
            }}
            vide={t("fiche.nonRenseigne")}
            marque={luDeLaCarte.has("regime_tva") ? marque : undefined}
          />
          <Fondement texte={fondementDe("tva", regimeTva)} />

          {/* Le prorata n'existe que pour un assujetti partiel : la base le
              refuse ailleurs, l'écran ne le propose donc pas ailleurs. */}
          {regimeTva === PARTIEL ? (
            <Champ
              label={t("fiche.champ.prorata")}
              valeur={prorata}
              onChange={setProrata}
              type="number"
              aide={t("fiche.aide.prorata")}
            />
          ) : null}
        </div>

        {/* ── la société ─────────────────────────────────────────────── */}
        <div className="sec">
          <h2>{t("pme.fiche.secSociete")}</h2>
          <span>{t("pme.fiche.duReferentiel")}</span>
        </div>
        <div className="pan">
          {/* La forme et le mode de dépôt décident des délais : sans les deux,
              Malica ne dérive aucune échéance — et le dit. */}
          <Axe
            label={t("fiche.champ.forme")}
            options={choixDe("forme")}
            valeur={forme}
            onChange={setForme}
            vide={t("fiche.nonRenseigne")}
          />
          <Axe
            label={t("fiche.champ.mode")}
            options={choixDe("mode")}
            valeur={mode}
            onChange={setMode}
            vide={t("fiche.nonRenseigne")}
          />
          <p>{t("fiche.aide.forme")}</p>
          <Champ
            label={t("fiche.champ.secteur")}
            valeur={secteur}
            onChange={setSecteur}
            marque={luDeLaCarte.has("secteur") ? marque : undefined}
          />
        </div>

        {/* ── l'exercice ─────────────────────────────────────────────── */}
        <div className="sec">
          <h2>{t("pme.fiche.secExercice")}</h2>
          <span>{t("pme.fiche.deuxDates")}</span>
        </div>
        <div className="pan">
          <Champ
            label={t("fiche.champ.debut")}
            valeur={debut}
            onChange={setDebut}
            type="date"
            marque={luDeLaCarte.has("debut_activite") ? marque : undefined}
          />
          <Champ
            label={t("fiche.champ.cloture")}
            valeur={cloture}
            onChange={setCloture}
            aide={t("fiche.aide.cloture")}
          />
        </div>

        {/* ── ce qui va être inscrit, puis l'engagement ───────────────── */}
        <div className="sec">
          <h2>{t("pme.fiche.secArret")}</h2>
          <span>{dateLisible(AUJOURDHUI())}</span>
        </div>
        <div className="pan">
          <div className="bil">
            <b>
              {remplis} {t("pme.fiche.bilSur")} {CHAMPS.length}
            </b>{" "}
            {t("pme.fiche.bilChamps")}{" "}
            {courante.data ? t("pme.fiche.bilRemplace") : t("pme.fiche.bilPremiere")}
          </div>
          {/*
           * La source, dite AVANT d'enregistrer. `etablirFiche` inscrit
           * « carte » seulement si l'œil a rempli quelque chose : l'écran
           * annonce donc ce qu'il va inscrire, il ne le découvre pas après.
           */}
          <div className="fixe">
            <IconeCadenas />
            {luDeLaCarte.size > 0
              ? t("pme.fiche.fixeSourceCarte")
              : t("pme.fiche.fixeSourceSaisie")}
          </div>
        </div>

        {/*
         * `.go .pr` : le bouton d'engagement de la famille — celui par lequel
         * `arr` crée la société. `.go .sc2` n'est pas rendu : aucune seconde
         * action de bas de page n'est vraie ici, et `.top .bk` fait le retour.
         */}
        <div className="go">
          <button
            type="button"
            className="pr"
            disabled={rien || enregistrement.isPending}
            onClick={() => enregistrement.mutate()}
          >
            {t("fiche.enregistrer")}
          </button>
        </div>

        {/*
         * La phrase de clôture, en `.foot` comme le dessin.
         *
         * Une version de ce fichier employait `.regle` à la place, en affirmant
         * que `.foot` n'était déclaré que sous `[data-ecran="charges"]`.
         * C'était faux : `[data-surface="pme"] .foot` est déclaré au niveau de
         * la SURFACE et peint donc sur les treize écrans. Le relevé qui disait
         * l'inverse cherchait `.foot` sous `[data-famille="papiers"]`
         * seulement.
         *
         * Ce qu'elle dit n'est pas `fiche.promesse` — cette phrase-là est
         * dans la voix de Malica, et la redire ici ferait deux fois la même
         * sur un écran. Elle dit la conséquence de la source, que `.fixe`
         * annonce juste au-dessus.
         */}
        <p className="foot">{t("pme.fiche.regleSaisie")}</p>
      </div>

      {scanne ? (
        <Suspense fallback={null}>
          <CameraScanner
            onCancel={() => setScanne(false)}
            /*
             * Le repli DOIT photographier.
             *
             * Il fermait seulement l'obturateur : sur un téléphone en HTTP — là
             * où le cadrage assisté est refusé et où ce bouton est justement le
             * seul chemin — on tapait dans le vide.
             *
             * L'appareil photo natif donne la même image, et la lecture qui suit
             * est identique.
             */
            onFallback={() => {
              setScanne(false);
              void files.takePhoto().then(([pris]) => {
                // Une carte tient sur une face : une photo, la première.
                if (pris) lecture.mutate(pris.blob);
              });
            }}
            onDone={(pages) => {
              setScanne(false);
              // Une carte tient sur une face : on lit la première prise.
              if (pages[0]) lecture.mutate(pages[0]);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * Le code du référentiel qui ouvre le prorata.
 *
 * Il était écrit trois fois en clair dans le corps de l'écran. C'est toujours
 * un code du référentiel écrit dans le composant — un défaut PRÉEXISTANT au
 * regard de R8, qui reste signalé et non corrigé ici : le réparer demande que
 * la base dise elle-même quel axe TVA ouvre un prorata (un drapeau sur
 * `RegimeDisponible`), et cela se décide au contrat, pas dans une route.
 * Nommé une seule fois, au moins, pour que la correction soit un geste.
 */
const PARTIEL = "partiel";

/** La date que `etablirFiche` inscrira — la même que le bilan annonce. */
const AUJOURDHUI = () => new Date().toISOString().slice(0, 10);

/** Le libellé d'un code du référentiel, dans la langue de la personne. */
function libelleDuChoix(axe: "forme" | "mode", code: string, t: (k: MessageKey) => string) {
  /*
   * DÉFAUT PRÉEXISTANT, SIGNALÉ. La LISTE vient bien de la base
   * (`formesDisponibles`) — R8 est tenue sur ce qui compte. Mais les libellés
   * passent par cette table de quatre entrées écrite ici : une forme nouvelle
   * au référentiel s'afficherait par son code brut. `FormeDisponible` ne
   * porte pas de `libelle`, là où `RegimeDisponible` en porte un — c'est au
   * contrat que ça se répare, pas dans cette route.
   */
  const CLES: Record<string, MessageKey> = {
    "forme.physique": "fiche.forme.physique",
    "forme.morale": "fiche.forme.morale",
    "mode.papier": "fiche.mode.papier",
    "mode.electronique": "fiche.mode.electronique",
  };
  const cle = CLES[`${axe}.${code}`];
  return cle ? t(cle) : code;
}

/**
 * Un axe du référentiel, répondu par un choix parmi plusieurs.
 *
 * `.pan .chx` et non `.seg` : les options viennent de la base, leur nombre
 * n'est pas connu à l'écriture, et `.chx` est en `flex-wrap:wrap` quand
 * `.seg button` est en `flex:1`. Voir l'arbitrage n° 2 de l'en-tête.
 *
 * « Non renseigné » est la première pastille et non une absence : sans elle,
 * une valeur posée ne se retirerait plus — le `<select>` qu'on remplace avait
 * une option vide, le groupe de boutons doit avoir la sienne.
 */
function Axe({
  label,
  options,
  valeur,
  onChange,
  vide,
  marque,
}: {
  label: string;
  options: ReadonlyArray<{ code: string; libelle: string }>;
  valeur: string;
  onChange: (v: string) => void;
  vide: string;
  marque?: string | undefined;
}) {
  return (
    <>
      {/*
       * `.pan p` est le seul porteur de texte du panneau : le `<b>` distingue
       * la question de l'aide, qui est un `.pan p` elle aussi. La famille n'a
       * pas de primitive d'étiquette — c'est le troisième trou nommé.
       */}
      <p>
        <b>{label}</b>
        {marque ? ` · ${marque}` : ""}
      </p>
      <div className="chx" role="group" aria-label={label}>
        <button
          type="button"
          className={valeur === "" ? "on" : undefined}
          aria-pressed={valeur === ""}
          onClick={() => onChange("")}
        >
          {vide}
        </button>
        {options.map((o) => (
          <button
            key={o.code}
            type="button"
            className={valeur === o.code ? "on" : undefined}
            aria-pressed={valeur === o.code}
            onClick={() => onChange(o.code)}
          >
            {o.libelle}
          </button>
        ))}
      </div>
    </>
  );
}

/** Un champ libre ou une date. `.pan .champ`, la seule primitive de champ. */
function Champ({
  label,
  valeur,
  onChange,
  type,
  aide,
  marque,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  type?: string | undefined;
  aide?: string | undefined;
  marque?: string | undefined;
}) {
  const id = useId();
  return (
    <>
      <p id={`${id}-l`}>
        <b>{label}</b>
        {marque ? ` · ${marque}` : ""}
      </p>
      {/*
       * `aria-labelledby` et non `<label>` : `.pan p` est un paragraphe, et un
       * `<p>` dans un `<label>` n'est pas du contenu phrasé — ce serait du
       * balisage invalide. L'étiquette reste donc accessible sans sortir de la
       * primitive.
       */}
      <input
        id={id}
        aria-labelledby={`${id}-l`}
        className="champ"
        type={type ?? "text"}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
      />
      {aide ? <p>{aide}</p> : null}
    </>
  );
}

/**
 * Le fondement légal du régime choisi — `.pan .fixe`, la mention qui ne bouge
 * pas. Rien si la base n'en donne pas : un fondement inventé sur un régime
 * serait pire qu'un fondement absent.
 */
function Fondement({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return (
    <div className="fixe">
      <IconeCadenas />
      {texte}
    </div>
  );
}

/* ── les icônes, relevées sur les vues rendues de la maquette ──────────────
 *
 * Elles ne sont posées QUE là où la feuille les dimensionne : `.top .bk svg`,
 * `.top .ic svg`, `.mur svg`, `.regle svg`, `.pan .fixe svg`. Une icône
 * ailleurs serait une icône sans taille.
 */

/** La carte d'identification fiscale — relevée sur `arr`. */
function IconeCarte() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <circle cx="8.5" cy="11" r="2.2" />
      <path d="M5 16a3.6 3.6 0 0 1 7 0M14.5 10h4M14.5 13.5h4" />
    </svg>
  );
}

/** Le cercle d'information — relevé sur `rub` et `arr`. */
function IconeInfo() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.3" />
    </svg>
  );
}

/** Le cadenas — relevé sur `rub` (`.rb .ref`) et sur la barre du bas. */
function IconeCadenas() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}
