import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useFichesDesSocietes } from "@/hooks/use-fiches-des-societes";
import { useMonAcces } from "@/hooks/use-mon-acces";
import { usePiecesLuesDesSocietes } from "@/hooks/use-pieces-lues";
import { useRevenir } from "@/hooks/use-revenir";
import { useVoix } from "@/hooks/use-voix";
import portraitMalica from "@/assets/malica.webp";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { PAS_MS, morceaux, motsParPas, texteMontre } from "@/lib/mot-a-mot";
import { cabinetsDesSocietes } from "@/lib/votre-comptabilite";
import { office } from "@/verticals/malica-office/composition";
import type { SourceCitee } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/malica")({
  head: () => ({
    meta: [
      { title: "Malica — Malica Office" },
      {
        name: "description",
        content:
          "Posez votre question comptable, fiscale ou juridique. Malica cite l'article et sa version en vigueur, et remet à votre comptabilité ce qui engage votre dossier.",
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
 * Converser avec Malica — planche 8, approuvée le 7 novembre 2026.
 *
 * « Malica accueille, puis se range et laisse parler. » À l'ouverture, Malica
 * en grand : son portrait dans un halo vert, un salut, trois questions toutes
 * prêtes. À la première question, elle se replie dans l'en-tête et le fil
 * prend la place. Sa réponse s'écrit mot à mot (la vraie, déjà reçue :
 * `lib/mot-a-mot.ts`), avec ses sources. Le micro ouvre la voix : on parle,
 * la question part par le même appel que le clavier, et la réponse se lit à
 * voix haute (`hooks/use-voix.ts`) — là où l'appareil sait le faire.
 *
 * Sur ordinateur, trois colonnes : les conversations et la comptabilité à
 * gauche, le fil au centre, Malica et « Ce que j'ai utilisé » à droite.
 *
 * ============================================================== LE CÂBLAGE
 *
 * Les mêmes appels, vérifiés au `contrat/rpc.json` (R2) :
 *   `malica.demander`, `conversations.lister`, `conversations.ouvrir`,
 *   `conversations.supprimer`, `acces.monAcces`, `conseil.contexte`,
 *   `identity.monProfil` (le prénom du salut, clé partagée `mon-profil`),
 *   et `fichesDesSocietes` + les pièces lues (le canal de la comptabilité,
 *   mêmes clés que la bibliothèque).
 *
 * ================================================== CE QUI N'EST PAS MONTRÉ
 *
 * Le canal « Équipe » de la maquette : aucune messagerie d'équipe n'existe
 * dans le produit. Le canal de la comptabilité n'est pas un fil de messages
 * non plus : il ouvre le dossier du cabinet (planche 6), avec ce qui attend
 * un geste. « Que ce qui existe. »
 *
 * R3 : aucun chiffre n'est écrit ni déduit ici ; les nombres à l'écran sont
 * ceux du texte que le Socle a rendu et les comptes que les lectures renvoient.
 */
function PmeMalica() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const revenir = useRevenir();
  const voix = useVoix(locale);

  const [tours, setTours] = useState<Tour[]>([]);
  const [brouillon, setBrouillon] = useState("");
  const [filId, setFilId] = useState<string | null>(null);
  const [vue, setVue] = useState<"fil" | "liste">("fil");
  const [menu, setMenu] = useState<string | null>(null);
  /** La voix est ouverte (l'écran plein du micro). */
  const [enVoix, setEnVoix] = useState(false);
  /** La question en cours a été posée à la voix : sa réponse se lit à haute voix. */
  const parVoix = useRef(false);
  /** La dernière réponse reçue s'écrit mot à mot, une seule fois. */
  const [frais, setFrais] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  const filerEnBas = () => {
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }),
    );
  };

  const fils = useQuery({
    queryKey: ["malica-fils", pme.tenantId],
    queryFn: () => office().conversations.lister(pme.tenantId),
  });
  const acces = useMonAcces(pme.tenantId);
  const conseil = useQuery({
    queryKey: ["conseil-contexte", pme.tenantId],
    queryFn: () => office().conseil.contexte(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });
  const profil = useQuery({
    queryKey: ["mon-profil"],
    queryFn: () => office().identity.monProfil(),
    staleTime: 5 * 60_000,
  });

  // Le canal de la comptabilité : le cabinet qui tient CETTE société.
  const { ids, fiches } = useFichesDesSocietes();
  const lectures = usePiecesLuesDesSocietes(ids);
  const parSociete = new Map(ids.map((id, i) => [id, lectures[i]?.data ?? []]));
  const cabinet =
    cabinetsDesSocietes(fiches.data ?? [], parSociete).find((c) =>
      c.societes.includes(pme.tenantId),
    ) ?? null;

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
      setFrais(true);
      setTours((prec) => [
        ...prec,
        {
          role: "assistant",
          contenu: res.answer,
          sources: res.conseil?.sources,
          retenue: res.retenue,
        },
      ]);
      if (parVoix.current) voix.lire(res.answer);
      parVoix.current = false;
      void qc.invalidateQueries({ queryKey: ["malica-fils", pme.tenantId] });
      filerEnBas();
    },
    onError: () => {
      parVoix.current = false;
    },
  });

  const reprise = useMutation({
    mutationFn: (id: string) => office().conversations.ouvrir(id),
    onSuccess: (messages, id) => {
      setFilId(id);
      setFrais(false);
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

  useEffect(() => {
    setFilId(null);
    setTours([]);
    setVue("fil");
    setMenu(null);
    setFrais(false);
  }, [pme.tenantId]);

  function poser(q: string) {
    const texte = q.trim();
    if (!texte || question.isPending) return;
    voix.taire();
    setTours((prec) => [...prec, { role: "user", contenu: texte }]);
    setBrouillon("");
    setVue("fil");
    question.mutate(texte);
    filerEnBas();
  }

  function nouveauFil() {
    voix.taire();
    setFilId(null);
    setTours([]);
    setFrais(false);
    setVue("fil");
    requestAnimationFrame(() => champ.current?.focus());
  }

  function ouvrirLaVoix() {
    setEnVoix(true);
    voix.ecouter();
  }
  function envoyerLaVoix() {
    voix.arreter();
    setEnVoix(false);
    if (voix.entendu.trim()) {
      parVoix.current = true;
      poser(voix.entendu);
    }
  }
  function fermerLaVoix() {
    voix.annuler();
    setEnVoix(false);
  }

  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(new Date(iso));

  const cabinetNom = conseil.data?.cabinetNom ?? null;
  const aUnCabinet = Boolean(conseil.data?.cabinetId);
  const siege = acces.data?.role === "collaborateur";
  const listeDesFils = fils.data ?? [];
  const filCourant = filId ? listeDesFils.find((f) => f.id === filId) : undefined;

  const parle = tours.length > 0;
  const derniere = [...tours].reverse().find((x) => x.role === "assistant");
  const statut =
    question.isPending || voix.parle
      ? t("pme.malica.statut.repond")
      : derniere?.sources && derniere.sources.length > 0
        ? t("pme.malica.statut.cite")
        : t("pme.malica.statut.enLigne");
  const prenom = profil.data?.prenom?.trim() ?? "";
  const salut = `${new Date().getHours() >= 18 ? t("pme.malica.salut.soir") : t("pme.malica.salut.jour")}${prenom ? ` ${prenom}` : ""}.`;
  const questionsPretes = [
    t("pme.malica.pret.tva"),
    t("pme.malica.pret.retenue"),
    t("pme.malica.pret.garder"),
  ];

  /* --------------------------------------------------------- les canaux */
  const canaux = (
    <>
      <button type="button" className="cn on" onClick={nouveauFil}>
        <span className="ph" aria-hidden>
          <img src={portraitMalica} alt="" width={620} height={620} />
        </span>
        {t("malica.chat.her")}
      </button>
      {cabinet ? (
        <Link className="cn" to="/pme/comptabilite/$cabinetId" params={{ cabinetId: cabinet.id }}>
          <span className="ini" aria-hidden>
            {cabinet.nom.slice(0, 1).toLocaleUpperCase()}
          </span>
          {cabinet.nom}
          {cabinet.aRepondre > 0 ? <em>{cabinet.aRepondre}</em> : null}
        </Link>
      ) : null}
    </>
  );

  /* ------------------------------------------------- la liste des fils */
  const listeDeFils = (
    <>
      {fils.isPending ? (
        <p className="vide">{t("common.loading")}</p>
      ) : listeDesFils.length === 0 ? (
        <p className="vide">{t("malica.fils.vide")}</p>
      ) : (
        listeDesFils.map((f) => (
          <div key={f.id}>
            <div className={f.id === filId ? "th cour" : "th"}>
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
  );

  /* ------------------------------------------- Malica, en grand ou de côté */
  const orbe = (
    <div className={voix.parle || question.isPending ? "orbe parle" : "orbe"}>
      <i className="b1" aria-hidden />
      <i className="b2" aria-hidden />
      <img src={portraitMalica} alt={t("malica.chat.her")} width={620} height={620} />
    </div>
  );

  return (
    <div
      data-ecran="chat"
      data-parle={parle ? "" : undefined}
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      <div className="cols">
        {/* ------------------------------------ à gauche (ordinateur) */}
        <aside className="gauche" aria-label={t("malica.fils.titre")}>
          <p className="lbl">{t("pme.malica.canaux")}</p>
          <div className="canaux">{canaux}</div>
          <p className="lbl">
            {t("malica.fils.titre")} · {listeDesFils.length}
          </p>
          <button type="button" className="nouveau" onClick={nouveauFil}>
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("malica.fils.nouveau")}
          </button>
          {listeDeFils}
        </aside>

        {/* ------------------------------------------------- le centre */}
        <section className="centre">
          <div className="top">
            <button
              type="button"
              className="bk"
              aria-label={t("pme.regler.retour")}
              onClick={() => (vue === "liste" ? setVue("fil") : revenir("/pme"))}
            >
              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                <path d="M14.5 5.5L8 12l6.5 6.5" />
              </svg>
            </button>
            <span className="mini" aria-hidden>
              <img src={portraitMalica} alt="" width={620} height={620} />
            </span>
            <span className="qui">
              <b>{t("malica.chat.her")}</b>
              <span>{statut}</span>
            </span>
            <span className="chips">
              <button
                type="button"
                className="chip"
                aria-pressed={vue === "liste"}
                onClick={() => setVue(vue === "liste" ? "fil" : "liste")}
              >
                {t("malica.fils.voir")}
              </button>
              {cabinet ? (
                <Link
                  className="chip"
                  to="/pme/comptabilite/$cabinetId"
                  params={{ cabinetId: cabinet.id }}
                >
                  {cabinet.nom}
                  {cabinet.aRepondre > 0 ? <em>{cabinet.aRepondre}</em> : null}
                </Link>
              ) : null}
            </span>
          </div>

          <div className="pad">
            {vue === "liste" ? (
              <div className="liste-fils">
                <button type="button" className="nouveau" onClick={nouveauFil}>
                  <svg viewBox="0 0 24 24" className="g" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {t("malica.fils.nouveau")}
                </button>
                {listeDeFils}
              </div>
            ) : (
              <>
                {/* Malica en grand, avant la première question. */}
                <div className="hero" aria-hidden={parle || undefined}>
                  <div className="pres">
                    <i className="halo" aria-hidden />
                    <img src={portraitMalica} alt="" width={620} height={620} />
                  </div>
                  <p className="salut">
                    <span>{salut}</span>
                  </p>
                  <p className="sous">{t("pme.malica.sous")}</p>
                  <div className="sugg">
                    {questionsPretes.map((q) => (
                      <button
                        key={q}
                        type="button"
                        tabIndex={parle ? -1 : undefined}
                        disabled={question.isPending}
                        onClick={() => poser(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="msgs" aria-live="polite">
                  {filCourant ? <p className="jour">{dateCourte(filCourant.updatedAt)}</p> : null}
                  {tours.map((tour, i) =>
                    tour.role === "user" ? (
                      <div key={i} className="moi">
                        {tour.contenu}
                      </div>
                    ) : (
                      <Reponse
                        key={i}
                        tour={tour}
                        signe={i === premiereDeMalica(tours)}
                        motAMot={frais && i === tours.length - 1}
                        onEcrite={() => setFrais(false)}
                        retenue={t("pme.malica.retenue")}
                        nom={t("malica.chat.her")}
                      />
                    ),
                  )}
                  {question.isPending ? (
                    <div className="ecrit" role="status" aria-label={t("malica.chat.thinking")}>
                      <i />
                      <i />
                      <i />
                    </div>
                  ) : null}
                  {question.isError ? (
                    <div className="et1" role="alert">
                      <i />
                      {texteDeLErreur(question.error, "malica : question", t("malica.chat.error"))}
                    </div>
                  ) : null}
                </div>

                {parle && !(conseil.isPending || conseil.isError || acces.isPending) ? (
                  <div className="esc off">
                    <span className="av">{siege ? "·" : initiales(cabinetNom)}</span>
                    <span className="bd">
                      <b>
                        {siege
                          ? t("pme.malica.suiteTransmission")
                          : aUnCabinet
                            ? cabinetNom
                              ? t("pme.malica.suiteAvis", { cabinet: cabinetNom })
                              : t("pme.malica.suiteAvisSansNom")
                            : t("pme.malica.suiteSansCabinet")}
                      </b>
                      <span>
                        {siege || aUnCabinet
                          ? t("pme.malica.suitePasEncore")
                          : t("pme.malica.suiteSansCabinetDetail")}
                      </span>
                    </span>
                  </div>
                ) : null}

                <form
                  className="comp"
                  onSubmit={(e) => {
                    e.preventDefault();
                    poser(brouillon);
                  }}
                >
                  <input
                    ref={champ}
                    value={brouillon}
                    onChange={(e) => setBrouillon(e.target.value)}
                    placeholder={t("pme.malica.composer")}
                    aria-label={t("pme.malica.composer")}
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
                  {voix.disponible ? (
                    <button
                      type="button"
                      className="mic"
                      disabled={question.isPending}
                      aria-label={t("pme.malica.voix.parler")}
                      onClick={ouvrirLaVoix}
                    >
                      <svg viewBox="0 0 24 24" className="g" aria-hidden>
                        <rect x="9.2" y="3" width="5.6" height="11" rx="2.8" />
                        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
                        <path d="M12 18v3" />
                      </svg>
                    </button>
                  ) : null}
                </form>
                <p className="foot">{t("pme.malica.pied")}</p>
              </>
            )}
          </div>
        </section>

        {/* -------------------------------- à droite (ordinateur) */}
        <aside className="side" aria-label={t("malica.chat.her")}>
          {orbe}
          {voix.parle ? <Ondes /> : null}
          <p className="st">{statut}</p>
          <div className="src">
            <b>{t("pme.malica.utilise")}</b>
            {derniere?.sources && derniere.sources.length > 0 ? (
              <ul>
                {derniere.sources.map((s, k) => (
                  <li key={k}>
                    {s.corpus} <em>{s.numero || "—"}</em>
                  </li>
                ))}
              </ul>
            ) : (
              <span>{t("pme.malica.rienEncore")}</span>
            )}
          </div>
        </aside>
      </div>

      {/* ------------------------------------------------------ la voix */}
      {enVoix ? (
        <div
          className="voix"
          role="dialog"
          aria-modal="true"
          aria-label={t("pme.malica.voix.parler")}
        >
          {orbe}
          {voix.ecoute ? <Ondes /> : null}
          <p className="dit" aria-live="polite">
            {voix.entendu ? `« ${voix.entendu} »` : t("pme.malica.voix.ecoute")}
          </p>
          <div className="b">
            <button
              type="button"
              className="go"
              disabled={!voix.entendu.trim()}
              onClick={envoyerLaVoix}
            >
              {t("malica.chat.send")}
            </button>
            <button type="button" onClick={fermerLaVoix}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Les sept barres qui bougent quand Malica écoute ou parle. */
function Ondes() {
  return (
    <span className="ondes" aria-hidden>
      {[0, 1, 2, 3, 4, 5, 6].map((k) => (
        <i key={k} />
      ))}
    </span>
  );
}

/**
 * Une réponse de Malica. La dernière reçue s'écrit mot à mot ; ses sources et
 * l'avis de relecture n'apparaissent qu'une fois tout le texte écrit. Si
 * l'appareil demande moins de mouvement, tout s'affiche d'un coup.
 */
function Reponse({
  tour,
  signe,
  motAMot,
  onEcrite,
  retenue,
  nom,
}: {
  tour: Tour;
  signe: boolean;
  motAMot: boolean;
  onEcrite: () => void;
  retenue: string;
  nom: string;
}) {
  const total = morceaux(tour.contenu).length;
  const [n, setN] = useState(() => (motAMot ? 0 : total));
  const fini = n >= total;
  useEffect(() => {
    if (!motAMot) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(total);
      return;
    }
    const pas = motsParPas(total);
    const h = window.setInterval(() => setN((x) => Math.min(total, x + pas)), PAS_MS);
    return () => window.clearInterval(h);
  }, [motAMot, total]);
  useEffect(() => {
    if (fini && motAMot) onEcrite();
  }, [fini, motAMot, onEcrite]);

  const texte = fini ? tour.contenu : texteMontre(tour.contenu, n);
  return (
    <>
      {signe ? (
        <div className="sig">
          <span className="ph">
            <img src={portraitMalica} alt="" width={620} height={620} />
          </span>
          <b>{nom}</b>
        </div>
      ) : null}
      <div className="mal" aria-busy={!fini || undefined}>
        {paragraphes(texte).map((para, k) => (
          <p key={k}>{para}</p>
        ))}
        {fini && tour.sources && tour.sources.length > 0 ? (
          <div className="srcs">
            {tour.sources.map((s, k) => (
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
        {fini && tour.retenue ? (
          <div className="et1">
            <i />
            {retenue}
          </div>
        ) : null}
      </div>
    </>
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
