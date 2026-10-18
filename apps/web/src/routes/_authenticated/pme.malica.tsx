import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";

import malicaLoin from "@/assets/malica-loin.webp";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import type { SourceCitee } from "@malica/socle/ports/repositories";

/* ═══════════════════════════════════════════════════════════════════════════
 *
 *   LES CHAÎNES PROPRES À CET ÉCRAN — UN SEUL BLOC, ET IL EST ICI
 *
 * Tout ce que le DICTIONNAIRE porte déjà passe par `t()` et n'est pas recopié
 * ici : le composeur, l'envoi, « Malica réfléchit… », l'erreur, l'intro, et
 * tout le vocabulaire des fils (`malica.fils.*`). Ces clés sont traduites en
 * FR, EN et AR ; les réécrire en dur aurait perdu l'arabe.
 *
 * Ne restent donc ci-dessous que les phrases que le DESSIN ajoute et que le
 * dictionnaire n'a pas encore — la suite du fil et le pied. Elles sont en
 * français, en dur, nommées, et visibles d'un coup d'œil : c'est exactement
 * ce qu'il y a à verser au dictionnaire, et rien d'autre.
 * ═══════════════════════════════════════════════════════════════════════ */
const TEXTES = {
  /** Le nom qu'on lit en tête du fil, à côté de son visage. */
  malica: "Malica",
  /** Ce que le composeur propose, dans la voix du dessin. */
  composer: "Écrivez à Malica…",
  /** Ce que la barre d'appel du dessin propose, en tête de la liste. */
  poser: "Posez votre question…",
  /** La suite du fil, quand un cabinet est mandaté et porte un nom. */
  suiteAvis: (cabinet: string) => `Demander l'avis de ${cabinet}`,
  /** La même, quand le cabinet existe mais n'a pas rendu son nom. */
  suiteAvisSansNom: "Demander l'avis de votre cabinet",
  /** La suite d'un siège : lui ne transmet pas, il demande. */
  suiteTransmission: "Demander la transmission au propriétaire du dossier",
  /** Et pourquoi le geste n'est pas encore offert ici. Voir R-CÂBLAGE ci-dessous. */
  suitePasEncore: "La demande n'est pas encore ouverte depuis cet écran",
  /** Aucun mandat : le geste n'a nulle part où aller, et l'écran le dit. */
  suiteSansCabinet: "Demander l'avis d'un cabinet",
  suiteSansCabinetDetail: "Aucun cabinet n'est mandaté sur ce dossier",
  /** L'état du dessin quand Malica remet sa réponse au cabinet. */
  retenue: "Envoyée en relecture — cet avis engage votre dossier",
  /** Le pied du fil — repris mot pour mot du dessin. */
  pied:
    "Je cite l'article et sa version en vigueur à la date. Je ne tranche pas à la " +
    "place de votre expert-comptable sur ce qui engage votre dossier.",
} as const;

export const Route = createFileRoute("/_authenticated/pme/malica")({
  head: () => ({
    meta: [
      { title: "Malica — Malica Office" },
      {
        name: "description",
        content:
          "Posez votre question comptable, fiscale ou juridique. Malica cite l'article et sa version en vigueur, et remet au cabinet ce qui engage votre dossier.",
      },
      { property: "og:title", content: "Malica — Malica Office" },
      {
        property: "og:description",
        content: "La conversation avec Malica : la réponse, sa source, et la suite du fil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeMalica,
});

/**
 * Un tour du fil, tel que CET écran l'affiche.
 *
 * `sources` et `retenue` ne descendent QUE d'une réponse fraîche
 * (`ReponseDeMalica`) : un fil repris par `conversations.ouvrir` rend des
 * `MessageDuFil`, qui ne portent ni l'un ni l'autre. Les deux sont donc
 * facultatifs — et déclarés `| undefined`, parce que
 * `exactOptionalPropertyTypes` est vrai et qu'un `sources?: SourceCitee[]`
 * refuse qu'on y pose `undefined`.
 */
interface Tour {
  role: "user" | "assistant";
  contenu: string;
  /** Les articles cités, pour les jetons `.srcs`. Absents sur un tour relu. */
  sources?: SourceCitee[] | undefined;
  /** Malica a remis sa réponse au cabinet : l'état `.et1` du dessin le dit. */
  retenue?: boolean | undefined;
}

/**
 * Converser avec Malica — l'écran du dessin, et son câblage.
 *
 * ================================================================= POURQUOI
 *
 * Cet écran rendait `MalicaChat` tel quel à l'intérieur d'une coque dessinée.
 * Le résultat se voyait, et le dirigeant l'a dit : « le chat avec Malica,
 * c'est l'ancienne screen peinte ». Il avait raison — `MalicaChat` écrit son
 * propre balisage en utilitaires Edition One, et aucune classe du dessin ne
 * pouvait descendre dessus.
 *
 * La logique DESCEND donc ici, et le balisage devient celui de
 * `malica-chat.html`. Rien du câblage ne change : ce sont les MÊMES appels,
 * aux mêmes noms, dans le même ordre.
 *
 * ============================================================== LE CÂBLAGE
 *
 * Tous vérifiés au `contrat/rpc.json` avant d'être écrits (R2 — le dépôt est
 * un `Proxy`, une méthode inventée compile et ne casse que chez le dirigeant) :
 *
 *   `malica.demander`            — poser la question (API, pas /rpc : un appel
 *                                  de modèle dure plus que la transaction)
 *   `conversations.lister`       — ses fils
 *   `conversations.ouvrir`       — reprendre un fil
 *   `conversations.supprimer`    — l'effacer
 *   `acces.monAcces`             — qui je suis dans ce dossier
 *   `conseil.contexte`           — y a-t-il un cabinet, et son nom
 *
 * L'historique ne remonte pas d'ici : on envoie l'identifiant du fil, et le
 * serveur relit ce que la RLS l'autorise à relire. Un fil composé par le
 * navigateur serait un fil qu'on peut forger.
 *
 * ========================================== CE QUE LE DESSIN MONTRE ET QU'ON NE SERT PAS
 *
 * Relevé, pas contourné — chacun manque d'une donnée ou d'une méthode :
 *
 *   `.cab` (la carte du cabinet dans le fil) — `MessageDuFil.role` ne connaît
 *   que `user` et `assistant`. Aucun message d'expert ne descend par ce port.
 *
 *   `.tabs` en filtre de domaine (Tout · Comptable · Fiscal · Juridique) —
 *   `ConversationResume` ne porte pas de domaine. Un filtre qui ne filtre pas
 *   est pire que son absence ; `.tabs` sert ici le passage liste/fil, qui est
 *   le seul choix que la donnée permette.
 *
 *   `.th .et` (« Avis de… », « En relecture au cabinet ») — même raison :
 *   aucun état d'arbitrage dans le résumé d'un fil.
 *
 *   `.undo` (« Fil supprimé · Annuler ») — `conversations.supprimer` est
 *   définitif, et le dictionnaire le dit déjà : « Elle ne se retrouve pas ».
 *   Offrir « Annuler » serait mentir.
 *
 *   le micro de `.comp` — aucune dictée dans le produit. Un bouton qui ne
 *   fait rien dans un composeur se tape une fois, pas deux.
 *
 *   le lien des jetons `.srcs` — `SourceCitee` donne le corpus et le numéro,
 *   pas d'adresse. Les jetons sont rendus sans `href` : ils citent, ils
 *   n'ouvrent pas. Un `href="#"` serait un lien qui ne mène nulle part.
 *
 * ================================================= L'EN-TÊTE, ET POURQUOI PAS `.top`
 *
 * `.top` n'est PAS rendu, et c'est mesuré : la feuille porte
 * `.app:has([data-ecran] .top) > header { display: none }`, donc rendre
 * `.top` ferait disparaître l'en-tête du layout — qui porte `EntetePme`, le
 * sélecteur de dossier. Le dessin n'a pas de sélecteur de dossier à mettre à
 * sa place. Les deux doivent donc changer ensemble, et `pme.tsx` n'est pas de
 * ce fichier. Le retour est celui du layout et de la barre du bas.
 *
 * ========================================================== R3, ET R-CÂBLAGE
 *
 * « Malica appelle, elle ne calcule pas. » Aucun chiffre n'est écrit ni déduit
 * ici : les seuls nombres à l'écran sont ceux du texte que le Socle a rendu,
 * et le compte de messages que `conversations.lister` renvoie.
 *
 * Et `conseil.creer` — ce que le câblage nomme pour « poser la question au
 * cabinet » — est au contrat mais ABSENT de `ConseilRepository`. L'ajouter au
 * port depuis un écran serait écrire le contrat par le haut. La carte de suite
 * reste donc VERROUILLÉE : elle dit ce qu'elle ferait, elle ne disparaît pas.
 */
function PmeMalica() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();

  const [tours, setTours] = useState<Tour[]>([]);
  const [brouillon, setBrouillon] = useState("");
  const [filId, setFilId] = useState<string | null>(null);
  const [vue, setVue] = useState<"fil" | "liste">("fil");
  /*
   * Deux gestes pour effacer : les points ouvrent le panneau `.del`, le
   * panneau exécute. Un fil supprimé ne se retrouve pas, et un seul tap n'est
   * pas une décision.
   */
  const [menu, setMenu] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  /*
   * Le fil se lit en bas : c'est la FENÊTRE qui défile, pas un conteneur.
   * `.comp` est `position:sticky;bottom:0` dans la feuille — le dessin veut
   * une page qui défile sous un composeur qui reste, pas une boîte à
   * ascenseur au milieu de l'écran.
   */
  const filerEnBas = () => {
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }),
    );
  };

  const fils = useQuery({
    queryKey: ["malica-fils", pme.tenantId],
    queryFn: () => office().conversations.lister(pme.tenantId),
  });

  /*
   * Qui je suis dans ce dossier. Même clé que `pme.piece.$pieceId` — une
   * seule lecture du rôle pour toute la navigation, et le même `staleTime` :
   * un rôle ne change pas entre deux écrans.
   */
  const acces = useQuery({
    queryKey: ["mon-acces", pme.tenantId],
    queryFn: () => office().acces.monAcces(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  /*
   * Y a-t-il un cabinet, et comment s'appelle-t-il. Le nom sert la carte de
   * suite : le dirigeant connaît son cabinet par son nom, et « votre
   * comptable » est une périphrase. Pas de repli — chargement, échec et
   * absence de mandat se disent différemment plus bas.
   */
  const conseil = useQuery({
    queryKey: ["conseil-contexte", pme.tenantId],
    queryFn: () => office().conseil.contexte(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const question = useMutation({
    mutationFn: async (q: string) =>
      office().malica.demander({
        tenantId: pme.tenantId,
        pieceId: null,
        question: q,
        locale,
        mode: "reasoner",
        conversationId: filId,
      }),
    onSuccess: (res) => {
      setFilId(res.conversationId);
      setTours((prec) => [
        ...prec,
        {
          role: "assistant",
          contenu: res.answer,
          sources: res.conseil?.sources,
          retenue: res.retenue,
        },
      ]);
      void qc.invalidateQueries({ queryKey: ["malica-fils", pme.tenantId] });
      filerEnBas();
    },
  });

  const reprise = useMutation({
    mutationFn: (id: string) => office().conversations.ouvrir(id),
    onSuccess: (messages, id) => {
      setFilId(id);
      setTours(messages.map((m) => ({ role: m.role, contenu: m.contenu })));
      setVue("fil");
      filerEnBas();
    },
  });

  const effacement = useMutation({
    mutationFn: (id: string) => office().conversations.supprimer(id),
    onSuccess: (_r, id) => {
      setMenu(null);
      if (id === filId) {
        setFilId(null);
        setTours([]);
      }
      void qc.invalidateQueries({ queryKey: ["malica-fils", pme.tenantId] });
    },
  });

  /*
   * Changer de dossier change de fils : garder l'ancien à l'écran montrerait
   * les questions d'une société pendant qu'on en regarde une autre.
   */
  useEffect(() => {
    setFilId(null);
    setTours([]);
    setVue("fil");
    setMenu(null);
  }, [pme.tenantId]);

  function envoyer() {
    const q = brouillon.trim();
    if (!q || question.isPending) return;
    setTours((prec) => [...prec, { role: "user", contenu: q }]);
    setBrouillon("");
    question.mutate(q);
    filerEnBas();
  }

  function nouveauFil() {
    setFilId(null);
    setTours([]);
    setVue("fil");
    requestAnimationFrame(() => champ.current?.focus());
  }

  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(new Date(iso));

  const cabinetNom = conseil.data?.cabinetNom ?? null;
  const aUnCabinet = Boolean(conseil.data?.cabinetId);
  /*
   * Un siège ne transmet pas : il demande, et c'est le propriétaire qui
   * tranche — la même règle que pour ses pièces. Le rôle décide donc de la
   * phrase, pas seulement du droit.
   */
  const siege = acces.data?.role === "collaborateur";

  const listeDesFils = fils.data ?? [];
  const filCourant = filId ? listeDesFils.find((f) => f.id === filId) : undefined;

  return (
    /*
     * `data-ecran="chat"` : le marqueur qui fait descendre sur cet arbre les
     * règles du dessin. Les marges négatives annulent le `px-4 py-5` du
     * layout — `.pad` porte la sienne, et le dessin ne veut pas de double
     * gouttière. Ce sont les deux SEULES utilitaires du fichier, et elles ne
     * peignent rien.
     */
    <div data-ecran="chat" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="pad">
        {vue === "liste" ? (
          <>
            {/*
             * La barre d'appel du dessin. Elle ouvre un fil neuf et donne le
             * focus au composeur — ce qu'elle ne pouvait pas faire quand le
             * composeur appartenait à un autre composant.
             */}
            <button type="button" className="poser" onClick={nouveauFil}>
              <span className="ph">
                <img src={malicaLoin} alt="" width={620} height={620} />
              </span>
              <span>{TEXTES.poser}</span>
              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                <rect x="9.2" y="3" width="5.6" height="11" rx="2.8" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
                <path d="M12 18v3" />
              </svg>
            </button>

            <div className="tabs">
              <button type="button" onClick={() => setVue("fil")}>
                {t("malica.fils.retour")}
              </button>
            </div>

            <p className="lbl">
              {t("malica.fils.titre")} · {listeDesFils.length}
            </p>

            {fils.isPending ? (
              <p className="vide">{t("common.loading")}</p>
            ) : listeDesFils.length === 0 ? (
              <p className="vide">{t("malica.fils.vide")}</p>
            ) : (
              listeDesFils.map((f) => (
                <div key={f.id}>
                  <div className="th">
                    <button type="button" className="op" onClick={() => reprise.mutate(f.id)}>
                      <span className="hd">
                        <b>{f.titre || t("malica.fils.sansTitre")}</b>
                        <span className="dt">{dateCourte(f.updatedAt)}</span>
                      </span>
                      <span className="ex">{t("malica.fils.messages", { count: f.messages })}</span>
                    </button>
                    <button
                      type="button"
                      className="dots"
                      aria-label={t("malica.fils.supprimer")}
                      onClick={() => setMenu(menu === f.id ? null : f.id)}
                    >
                      <svg viewBox="0 0 24 24" className="g" aria-hidden>
                        <circle cx="12" cy="5.5" r="1.1" />
                        <circle cx="12" cy="12" r="1.1" />
                        <circle cx="12" cy="18.5" r="1.1" />
                      </svg>
                    </button>
                  </div>
                  {menu === f.id ? (
                    <div className="del">
                      <p>{t("malica.fils.confirmer")}</p>
                      <div className="b">
                        <button
                          type="button"
                          className="go"
                          disabled={effacement.isPending}
                          onClick={() => effacement.mutate(f.id)}
                        >
                          {t("malica.fils.supprimer")}
                        </button>
                        <button type="button" onClick={() => setMenu(null)}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </>
        ) : (
          <>
            <div className="tabs">
              <button type="button" onClick={() => setVue("liste")}>
                {t("malica.fils.voir")}
              </button>
              {tours.length > 0 ? (
                <button type="button" onClick={nouveauFil}>
                  {t("malica.fils.nouveau")}
                </button>
              ) : null}
            </div>

            {/*
             * ------------------------------------------------------------ le fil
             *
             * `aria-live="polite"` : la réponse arrive sans que personne ne
             * l'ait demandée à l'écran. Sans annonce, un lecteur d'écran
             * laisse le dirigeant devant un silence.
             */}
            <div className="msgs" aria-live="polite">
              {filCourant ? <p className="jour">{dateCourte(filCourant.updatedAt)}</p> : null}

              {tours.length === 0 ? <p className="vide">{t("malica.chat.intro")}</p> : null}

              {tours.map((tour, i) =>
                tour.role === "user" ? (
                  <div key={i} className="moi">
                    {tour.contenu}
                  </div>
                ) : (
                  <Fragment key={i}>
                    {/*
                     * « Son visage n'apparaît qu'une fois, en tête du fil. »
                     * Malica parle le plus, donc elle se montre le moins :
                     * pas d'avatar répété, pas d'étiquette au-dessus de
                     * chaque réponse. `alt=""` — le nom est juste à côté, en
                     * texte ; le répéter ferait entendre « Malica Malica ».
                     */}
                    {i === premiereDeMalica(tours) ? (
                      <div className="sig">
                        <span className="ph">
                          <img src={malicaLoin} alt="" width={620} height={620} />
                        </span>
                        <b>{TEXTES.malica}</b>
                      </div>
                    ) : null}
                    <div className="mal">
                      {/*
                       * Un `<p>` par paragraphe, parce que c'est ce que le
                       * dessin peint : `.mal p+p` porte l'interligne entre
                       * deux paragraphes. Une seule balise aurait aplati la
                       * réponse du modèle en un bloc. Les retours simples
                       * restent tenus par `white-space` dans la feuille.
                       */}
                      {paragraphes(tour.contenu).map((para, k) => (
                        <p key={k}>{para}</p>
                      ))}
                      {tour.sources && tour.sources.length > 0 ? (
                        <div className="srcs">
                          {tour.sources.map((s, k) => (
                            /*
                             * Sans `href` : `SourceCitee` donne le corpus et
                             * le numéro, aucune adresse. Le jeton cite, il
                             * n'ouvre pas.
                             */
                            <a key={k}>
                              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                                <path d="M6 3h8l4 4v14H6z" />
                                <path d="M14 3v4h4" />
                              </svg>
                              {s.corpus} <em>{s.numero || "—"}</em>
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {tour.retenue ? (
                        <div className="et1">
                          <i />
                          {TEXTES.retenue}
                        </div>
                      ) : null}
                    </div>
                  </Fragment>
                ),
              )}

              {question.isPending ? (
                <div className="et1" role="status">
                  <i />
                  {t("malica.chat.thinking")}
                </div>
              ) : null}

              {question.isError ? (
                <div className="et1" role="alert">
                  <i />
                  {question.error instanceof Error
                    ? question.error.message
                    : t("malica.chat.error")}
                </div>
              ) : null}
            </div>

            {/*
             * ------------------------------------------------- la suite du fil
             *
             * « Un fil porte toujours sa suite. Le dernier état est une
             * action, jamais un cul-de-sac. » Ici la suite est verrouillée, et
             * une carte verrouillée dit ce qu'elle ferait — comme les cartes
             * `.lock` de l'accueil. Ce qui manque est nommé en tête du
             * fichier : `conseil.creer`, au contrat, absent du port.
             *
             * Rien n'est rendu tant qu'on ne sait pas : pendant le chargement
             * et en cas d'échec, l'écran se tait plutôt que d'annoncer « aucun
             * cabinet » à un dossier qui en a un.
             */}
            {conseil.isPending || conseil.isError || acces.isPending ? null : (
              <div className="esc off">
                <span className="av">{siege ? "·" : initiales(cabinetNom)}</span>
                <span className="bd">
                  <b>
                    {siege
                      ? TEXTES.suiteTransmission
                      : aUnCabinet
                        ? cabinetNom
                          ? TEXTES.suiteAvis(cabinetNom)
                          : TEXTES.suiteAvisSansNom
                        : TEXTES.suiteSansCabinet}
                  </b>
                  <span>
                    {siege || aUnCabinet ? TEXTES.suitePasEncore : TEXTES.suiteSansCabinetDetail}
                  </span>
                </span>
              </div>
            )}

            {/*
             * Le composeur. Un `<form>` et non un `<div>` : la touche Entrée
             * et le clavier mobile « Envoyer » marchent alors sans qu'on les
             * écoute à la main. La feuille ne vise que `.comp`, elle ne
             * regarde pas l'élément.
             */}
            <form
              className="comp"
              onSubmit={(e) => {
                e.preventDefault();
                envoyer();
              }}
            >
              <input
                ref={champ}
                value={brouillon}
                onChange={(e) => setBrouillon(e.target.value)}
                placeholder={TEXTES.composer}
                aria-label={TEXTES.composer}
              />
              <button
                type="submit"
                className="go"
                disabled={question.isPending || !brouillon.trim()}
                aria-label={t("malica.chat.send")}
              >
                <svg viewBox="0 0 24 24" className="g" aria-hidden>
                  <path d="M12 19V5" />
                  <path d="M6 11l6-6 6 6" />
                </svg>
              </button>
            </form>

            {/*
             * Le pied, mot pour mot du dessin. Il ne dépend d'aucune lecture :
             * c'est la règle du produit, et elle vaut avant la première
             * question. Le rôle ne la change pas — elle vaut pour le dirigeant
             * comme pour le siège.
             */}
            <p className="foot">{TEXTES.pied}</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Le texte d'une réponse, coupé en paragraphes.
 *
 * Coupé sur la LIGNE VIDE, qui est ce qu'un modèle écrit pour séparer deux
 * paragraphes. Les retours simples ne coupent pas : ils appartiennent à une
 * énumération, et la feuille les tient (`white-space`). Un texte sans ligne
 * vide rend un seul paragraphe, et un texte vide n'en rend aucun plutôt qu'une
 * bulle vide.
 */
function paragraphes(texte: string): string[] {
  return texte
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * L'indice du premier tour de Malica — celui qui porte sa signature.
 *
 * Calculé, et non mémorisé dans le tour : un tour est ce que le serveur a
 * rendu, pas une place dans une liste. Si le premier tour de Malica est
 * effacé par une reprise de fil, la signature suit sans qu'on y pense.
 */
function premiereDeMalica(tours: Tour[]): number {
  return tours.findIndex((x) => x.role === "assistant");
}

/**
 * Les initiales d'un cabinet, pour la pastille de `.esc .av`.
 *
 * Deux lettres au plus — c'est ce que la pastille de 30 px tient en 10 px de
 * corps. Sans nom, un point médian : il occupe la place sans rien affirmer, là
 * où un « ? » demanderait une réponse que personne n'a.
 */
function initiales(nom: string | null): string {
  if (!nom) return "·";
  const mots = nom
    .split(/[\s-]+/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  if (mots.length === 0) return "·";
  return mots
    .slice(0, 2)
    .map((m) => m.charAt(0).toLocaleUpperCase("fr"))
    .join("");
}
