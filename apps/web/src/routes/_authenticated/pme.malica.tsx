/**
 * Converser avec Malica — l'écran où le dirigeant pose ses questions.
 *
 * Écran de la PME : Malica accueille avec trois questions toutes prêtes, puis se range dans
 * l'en-tête et laisse le fil parler. Sa réponse arrive en flux, après la garde des chiffres,
 * avec ses sources, ses propositions d'action à confirmer et ses suggestions de suite. Le
 * micro ouvre la voix là où l'appareil le permet. Une pièce jointe est déposée puis confiée
 * à la lecture Malica : le modèle n'en voit jamais l'image.
 *
 * R3 : aucun chiffre n'est écrit ni déduit ici ; ceux de l'écran viennent du texte rendu par
 * le Socle et des comptes renvoyés par les lectures. Les appels sont ceux du contrat RPC (R2).
 * Sur ordinateur, trois colonnes : conversations, fil, et ce que Malica a utilisé.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useFichesDesSocietes } from "@/hooks/use-fiches-des-societes";
import { useMonAcces } from "@/hooks/use-mon-acces";
import { usePiecesLuesDesSocietes } from "@/hooks/use-pieces-lues";
import { useRevenir } from "@/hooks/use-revenir";
import { useVoix } from "@/hooks/use-voix";
import portraitMalica from "@/assets/malica.webp";
import {
  ReponseDeMalica,
  useConversationMalica,
  useJointe,
  type TourDeMalica,
} from "@/components/malica/conversation-malica";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { cabinetsDesSocietes } from "@/lib/votre-comptabilite";
import { office } from "@/verticals/malica-office/composition";

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
 * Converser avec Malica — planche 8, approuvée le 7 novembre 2026.
 *
 * « Malica accueille, puis se range et laisse parler. » À l'ouverture, Malica
 * en grand : son portrait dans un halo vert, un salut, trois questions toutes
 * prêtes. À la première question, elle se replie dans l'en-tête et le fil
 * prend la place. Sa réponse arrive EN FLUX, mot à mot, au fil de ce que
 * Claude écrit et après la garde des chiffres (`malica/assistant/garde.ts`),
 * avec ses sources cliquables, ses propositions d'action à confirmer et ses
 * suggestions de suite (`conversation-malica.tsx`). Le micro ouvre la voix : on parle,
 * la question part par le même appel que le clavier, et la réponse se lit à
 * voix haute (`hooks/use-voix.ts`) — là où l'appareil sait le faire.
 *
 * Sur ordinateur, trois colonnes : les conversations et la comptabilité à
 * gauche, le fil au centre, Malica et « Ce que j'ai utilisé » à droite.
 *
 * ============================================================== LE CÂBLAGE
 *
 * Vérifiés au `contrat/rpc.json` (R2) :
 *   `malica.converser` (la réponse en flux, par l'API et non /rpc),
 *   `capture.register` puis `malica.demanderLaLecture` (une pièce jointe est
 *   déposée puis confiée à la lecture Malica — le modèle n'en voit jamais
 *   l'image), `conversations.lister`, `conversations.ouvrir` (un fil rouvert
 *   réaffiche les sources et les propositions rangées avec chaque réponse),
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

  const conversation = useConversationMalica(pme.tenantId);
  const { tours, filId, enCours } = conversation;
  const jointe = useJointe(pme.tenantId);
  const fichier = useRef<HTMLInputElement>(null);
  const [brouillon, setBrouillon] = useState("");
  const [vue, setVue] = useState<"fil" | "liste">("fil");
  const [menu, setMenu] = useState<string | null>(null);
  /** La voix est ouverte (l'écran plein du micro). */
  const [enVoix, setEnVoix] = useState(false);
  /** La question en cours a été posée à la voix : sa réponse se lit à haute voix. */
  const parVoix = useRef(false);
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

  const reprise = useMutation({
    mutationFn: (id: string) => office().conversations.ouvrir(id),
    onSuccess: (messages, id) => {
      voix.taire();
      conversation.reprendre(id, messages);
      setVue("fil");
      filerEnBas();
    },
  });

  const effacement = useMutation({
    mutationFn: (id: string) => office().conversations.supprimer(id),
    onSuccess: (_r, id) => {
      setMenu(null);
      if (id === filId) conversation.nouveau();
      void qc.invalidateQueries({ queryKey: ["malica-fils", pme.tenantId] });
    },
  });

  // Changer de dossier change de fils : l'ancien ne reste pas à l'écran.
  const { nouveau } = conversation;
  const { vider } = jointe;
  useEffect(() => {
    nouveau();
    vider();
    setVue("fil");
    setMenu(null);
  }, [pme.tenantId, nouveau, vider]);

  function poser(q: string) {
    const texte = q.trim();
    if (!texte || enCours) return;
    voix.taire();
    setBrouillon("");
    setVue("fil");
    const pieces = jointe.jointes.map((j) => j.id);
    jointe.vider();
    filerEnBas();
    void conversation.envoyer(texte, pieces).then(({ reponse }) => {
      if (parVoix.current && reponse) voix.lire(reponse);
      parVoix.current = false;
      void qc.invalidateQueries({ queryKey: ["malica-fils", pme.tenantId] });
      filerEnBas();
    });
  }

  function nouveauFil() {
    voix.taire();
    conversation.nouveau();
    jointe.vider();
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
    enCours || voix.parle
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
    <div className={voix.parle || enCours ? "orbe parle" : "orbe"}>
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
              {/*
               * Une icône, pas un mot (9 novembre 2026) : « Mes conversations »
               * écrasait « Malica · en ligne » sur le téléphone.
               */}
              <button
                type="button"
                className="chip ico"
                aria-pressed={vue === "liste"}
                aria-label={t("malica.fils.voir")}
                title={t("malica.fils.voir")}
                onClick={() => setVue(vue === "liste" ? "fil" : "liste")}
              >
                <svg viewBox="0 0 24 24" className="g" aria-hidden>
                  <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
                </svg>
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
                        disabled={enCours}
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
                        nom={t("malica.chat.her")}
                      >
                        <ReponseDeMalica
                          tour={tour}
                          tenantId={pme.tenantId}
                          espace="pme"
                          surSuggestion={poser}
                        />
                      </Reponse>
                    ),
                  )}
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

                {/*
                 * Les pièces jointes : déposées dans le dossier et confiées à
                 * la lecture Malica (R2) avant de partir avec la question. Le
                 * modèle n'en voit jamais l'image, seulement ce que la lecture
                 * en a relevé.
                 */}
                {jointe.jointes.length > 0 || jointe.deposer.isPending ? (
                  <div className="srcs">
                    {jointe.jointes.map((j) => (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => jointe.retirer(j.id)}
                        aria-label={`${t("pme.assistant.jointe.retirer")} — ${j.nom}`}
                      >
                        {t("pme.assistant.jointe.prete")} · {j.nom} ×
                      </button>
                    ))}
                    {jointe.deposer.isPending ? (
                      <span role="status">{t("pme.assistant.jointe.envoi")}</span>
                    ) : null}
                    {jointe.jointes.length > 0 ? (
                      <span>{t("pme.assistant.jointe.lecture")}</span>
                    ) : null}
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
                    ref={fichier}
                    type="file"
                    accept="image/*,application/pdf"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) jointe.deposer.mutate(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="mic"
                    aria-label={t("pme.assistant.joindre")}
                    title={t("pme.assistant.joindre")}
                    disabled={jointe.deposer.isPending || enCours}
                    onClick={() => fichier.current?.click()}
                  >
                    <svg viewBox="0 0 24 24" className="g" aria-hidden>
                      <path d="M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7L10.2 16.7a1.7 1.7 0 0 1-2.4-2.4L14.5 7.6" />
                    </svg>
                  </button>
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
                    disabled={enCours || !brouillon.trim()}
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
                      disabled={enCours}
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
                {derniere.sources.map((s) => (
                  <li key={s.cle}>{s.titre}</li>
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
 * Une réponse de Malica dans le fil : sa signature au premier tour, puis la
 * bulle. Le contenu (texte en flux, sources, propositions, suggestions) est
 * celui de `ReponseDeMalica`, partagé avec le panneau du cabinet.
 */
function Reponse({
  signe,
  nom,
  tour,
  children,
}: {
  signe: boolean;
  nom: string;
  tour: TourDeMalica;
  children: ReactNode;
}) {
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
      <div className="mal" aria-busy={tour.enCours || undefined}>
        {children}
      </div>
    </>
  );
}

/**
 * L'indice du premier tour de Malica — celui qui porte sa signature.
 *
 * Calculé, et non mémorisé dans le tour : un tour est ce que le serveur a
 * rendu, pas une place dans une liste. Si le premier tour de Malica est
 * effacé par une reprise de fil, la signature suit sans qu'on y pense.
 */
function premiereDeMalica(tours: TourDeMalica[]): number {
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
