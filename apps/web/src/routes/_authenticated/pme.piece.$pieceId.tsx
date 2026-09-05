import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { usePme } from "@/components/regalica/pme-context";
import { DocumentView } from "@/components/regalica/document-view";
import { pagesJpegDuPdf } from "@/capabilities/pages-du-pdf";
import { RegalicaAvatar } from "@/components/regalica/office-ui";
import { montant, quantite } from "@/lib/lisible";
import { office } from "@/verticals/regalica-office/composition";
import type { Citation } from "@regalica/socle/ports/repositories";
import { buildProposal, LectureIncomplete } from "@regalica/socle/use-cases/propose-ecriture";
import { texteDeLErreur } from "@/lib/erreur-lisible";

export const Route = createFileRoute("/_authenticated/pme/piece/$pieceId")({
  head: () => ({
    meta: [
      { title: "Ma pièce — Regalica Office" },
      {
        name: "description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source avant confirmation.",
      },
      { property: "og:title", content: "Ma pièce — Regalica Office" },
      {
        property: "og:description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source avant confirmation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PieceScreen,
});

/**
 * Du nom métier d'un champ vers son libellé d'écran.
 *
 * La correspondance vit ICI, et non dans le cas d'usage : le Socle nomme ses
 * champs, il n'a pas à connaître les clés de traduction. Et le compilateur
 * vérifie chaque clé — un libellé oublié ne passe pas.
 */
/** Les raisons MÉTIER pour lesquelles une lecture s'arrête, et leur phrase. */
const MESSAGE_DU_CODE_DE_LECTURE: Record<string, MessageKey> = {
  "lecture.illisible": "pme.lire.illisible",
  "lecture.vide": "pme.lire.vide",
  "lecture.trop_longue": "pme.lire.tropLongue",
  "lecture.trop_dense": "pme.lire.tropDense",
};

const LIBELLE_DU_CHAMP: Record<string, MessageKey> = {
  date: "piece.champ.date",
  emetteur: "piece.champ.emetteur",
  devise: "piece.champ.devise",
  lignes: "piece.champ.lignes",
  totaux: "piece.champ.totaux",
  type: "piece.champ.type",
};

interface ExtractArticle {
  designation: string;
  quantity: string | null;
  unit_price_ht: string | null;
  unit_price_ttc: string | null;
  total_ht: string | null;
  tax_code: string | null;
}

interface ExtractPayload {
  issuer?: string;
  document_date?: string;
  document_kind?: string;
  currency?: string;
  lines?: Array<{
    label: string;
    tax_code: string;
    base_ht: string;
    vat_amount: string;
    ttc: string;
  }>;
  articles?: ExtractArticle[];
  other_charges?: Array<{ code: string; label: string; amount: string }>;
  references?: Record<string, string>;
  totals?: { base_ht: string; vat: string; ttc: string };
}

/**
 * Écran PME. Le geste cœur : voir la zone source, confirmer en un tap.
 * L'écriture proposée et les signalements de lecture n'apparaissent pas ici :
 * ils appartiennent à la supervision du cabinet.
 */
function PieceScreen() {
  const { pieceId } = Route.useParams();
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * La requête de lecture est morte en route — téléphone verrouillé, page
   * rechargée, réseau coupé — mais la lecture continue côté serveur. On
   * attend son résultat au lieu d'annoncer une panne.
   */
  const [attente, setAttente] = useState(false);
  /**
   * Le soulagement n'arrive qu'une fois.
   *
   * Il est porté par un état d'écran, pas par le statut de la pièce : rouvrir
   * une facture comptabilisée trois jours plus tard ne doit pas rejouer la
   * coche. On fête la confirmation, pas la comptabilisation.
   */
  const [regle, setRegle] = useState(false);
  const [montrerPiece, setPiece] = useState(false);
  const [montrerDetail, setDetail] = useState(false);

  // Qui reçoit la pièce. Sans mandat, elle reste au dossier — et l'écran le
  // dit autrement plutôt que d'inventer un destinataire.
  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const navigate = useNavigate();
  const navigateList = () => navigate({ to: "/pme/list" });

  const dossier = useQuery({
    queryKey: ["piece", pieceId],
    queryFn: () => office().capture.dossier(pieceId),
  });

  /*
   * ==================================================== LE SCAN FINAL
   *
   * Ce que la personne voit avant de taper « Lire » est EXACTEMENT ce qui
   * sera lu : les images de page telles qu'elles sont enregistrées dans le
   * PDF, découpées sans les décoder. Un PDF qui ne vient pas de nous (un
   * fichier déposé) n'en porte pas forcément : la visionneuse prend alors
   * le relais.
   */
  const contenuBrut = dossier.data?.contenu ?? null;
  const pagesScan = useMemo(
    () => (contenuBrut ? pagesJpegDuPdf(contenuBrut).map((b) => URL.createObjectURL(b)) : []),
    [contenuBrut],
  );
  useEffect(() => () => pagesScan.forEach((u) => URL.revokeObjectURL(u)), [pagesScan]);

  /*
   * Une lecture tourne-t-elle déjà pour cette pièce ? Demandé au retour sur
   * l'écran, et redemandé tant que c'est le cas : le résultat arrive par le
   * dossier, pas par la requête qui l'a lancée.
   */
  const lue = dossier.data?.extraction != null;
  const etat = useQuery({
    queryKey: ["lecture-en-cours", pieceId],
    queryFn: () => office().capture.etatLecture(pieceId),
    enabled: !lue,
    refetchInterval: (q) => (q.state.data?.enCours || attente ? 3_000 : false),
  });
  useEffect(() => {
    if (!etat.data || etat.data.enCours) return;
    if (attente) {
      setAttente(false);
      void qc.invalidateQueries({ queryKey: ["piece", pieceId] });
      void qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
    }
  }, [etat.data, attente, qc, pieceId, pme.tenantId]);

  const ecritures = useQuery({
    queryKey: ["ecritures", pieceId],
    queryFn: () => office().office.ecrituresForPiece(pieceId),
  });

  const refs = useQuery({
    queryKey: ["ref-data", pme.packId],
    queryFn: async () => {
      const packId = pme.packId!;
      const [taxRates, mappings, fiscalCharges] = await Promise.all([
        office().referential.taxRates(packId, pme.jurisdiction),
        office().referential.accountMappings(packId),
        office().referential.fiscalCharges(packId),
      ]);
      return { taxRates, mappings, fiscalCharges };
    },
    enabled: !!pme.packId,
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
      qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
      qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] }),
    ]);
  };

  /*
   * ================================================ EFFACER UN BROUILLON
   *
   * Une photo ratée, un reçu personnel, un document qui n'a rien à faire là :
   * il n'existait aucun moyen de l'effacer, et le coffre accumulait.
   *
   * La base décide, pas cet écran : `capture_piece_supprimer` refuse une pièce
   * transmise, engagée dans une écriture, ou servant de justificatif. On ne
   * propose donc le geste que lorsqu'il a une chance d'aboutir — mais si
   * quelqu'un le tente ailleurs, le refus vient quand même.
   *
   * Deux temps, jamais un seul : un effacement ne se déclenche pas par mégarde.
   */
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const supprimer = useMutation({
    mutationFn: () => office().capture.supprimer(pieceId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
      void navigate({ to: "/pme/list" });
    },
    onError: (e: unknown) => {
      setConfirmerSuppression(false);
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error")));
    },
  });

  /**
   * Supprimer et reprendre : la page ne convient pas, on la retire et l'on
   * rouvre l'appareil photo. Un scan non lu et non transmis n'engage rien.
   */
  const reprendre = useMutation({
    mutationFn: () => office().capture.supprimer(pieceId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
      await navigate({ to: "/pme" });
      pme.ouvrirScanner();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * Le sens de la pièce, quand la lecture n'a pas pu le dire : un achat ou
   * une vente. La réponse est une entrée nouvelle (jamais une modification
   * de la lecture) ; le dossier la rend ensuite comme si elle avait été lue.
   */
  const preciser = useMutation({
    mutationFn: (valeur: "facture_achat" | "facture_vente") =>
      office().capture.preciser(pieceId, "document_kind", valeur),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /** Transmettre au cabinet — sur décision du dirigeant, jamais toute seule. */
  const transmettre = useMutation({
    mutationFn: () => office().collab.setPieceVis(pieceId, "partage"),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  const read = useMutation({
    mutationFn: () => office().capture.read(pieceId),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) => {
      /*
       * La chaîne de lecture parle en CODES, jamais en prose : la fonction
       * serveur ne transmet qu'un message nu, et c'est ici qu'il devient une
       * phrase dans la langue du dirigeant. Un message qui n'est pas un code
       * connu est technique : il va au journal, l'écran dit seulement qu'il
       * n'a pas pu.
       */
      // Une requête morte n'est pas une lecture morte : le serveur continue.
      // On attend, et le dossier dira quand c'est lu.
      if (e instanceof TypeError) {
        setAttente(true);
        void etat.refetch();
        return;
      }
      const code = e instanceof Error ? e.message : "";
      const libelle = MESSAGE_DU_CODE_DE_LECTURE[code];
      if (libelle) {
        setError(t(libelle));
        return;
      }
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error")));
    },
  });

  /*
   * ================================================ LA DATE QUAND LA PIÈCE N'EN PORTE PAS
   *
   * Certaines pièces n'affichent aucune date lisible : un ticket effacé, un
   * bon de livraison, un coin plié. Sans date, aucun taux de TVA n'est
   * applicable et rien ne peut être comptabilisé — la pièce restait bloquée.
   *
   * On propose donc le JOUR DU SCAN. Mais on ne le glisse pas en douce dans la
   * lecture : il s'affiche, il est modifiable, et il ne devient la date de la
   * pièce qu'au moment où l'utilisateur confirme. L'extraction, elle, garde sa
   * date vide — c'est ce qui s'est réellement lu sur le document.
   *
   * La distinction n'est pas une subtilité : une facture de janvier scannée en
   * mars et datée de mars part dans la mauvaise déclaration de TVA. C'est à
   * l'utilisateur de dire quelle est la vraie date ; nous ne faisons que la
   * pré-remplir avec la seule que nous connaissions.
   */
  const jourDuScan = (dossier.data?.piece.createdAt ?? new Date().toISOString()).slice(0, 10);
  const [dateSaisie, setDateSaisie] = useState<string | null>(null);
  const dateRetenue = dateSaisie ?? jourDuScan;

  const proposalAttempt = useMemo(() => {
    const brut = dossier.data?.extraction?.payload;
    if (!brut || !refs.data) return null;
    // La date saisie ne complète que ce qui manque : une date lue sur la pièce
    // n'est jamais remplacée.
    const lue = (brut as { document_date?: string }).document_date;
    const payload = lue?.trim() ? brut : { ...brut, document_date: dateRetenue };
    try {
      return {
        ok: true as const,
        value: buildProposal({
          pieceId,
          payload,
          taxRates: refs.data.taxRates,
          mappings: refs.data.mappings,
          fiscalCharges: refs.data.fiscalCharges,
          currency: pme.currency,
        }),
      };
    } catch (e) {
      /*
       * ================================================ CE QUE L'ON N'AFFICHE PLUS
       *
       * Le message brut d'un `ZodError` s'affichait ici, en anglais :
       * « [{"validation":"regex","message":"Date ISO YYYY-MM-DD requise",
       *    "path":["document_date"]}] ». La facture était pourtant bien lue —
       * seule la date manquait — et l'utilisateur restait devant un tableau
       * JSON sans savoir quoi faire.
       *
       * On nomme désormais les champs manquants en clair, et l'on dit quoi
       * faire. Le refus reste : sans date, aucun taux de TVA n'est applicable,
       * et Regalica n'invente pas de valeur.
       */
      if (e instanceof LectureIncomplete) {
        const champs = e.champs.map((c) => t(LIBELLE_DU_CHAMP[c] ?? "common.error")).join(", ");
        return { ok: false as const, reason: t("piece.incomplete", { champs }) };
      }
      return { ok: false as const, reason: t("common.error") };
    }
  }, [dossier.data, refs.data, pieceId, pme.currency, dateRetenue, t]);
  const proposal = proposalAttempt?.ok ? proposalAttempt.value : null;

  const booked = (ecritures.data ?? []).find((e) => e.status === "booked");

  /**
   * Un seul geste : la proposition du Socle et sa comptabilisation s'enchaînent.
   * La PME ne compose jamais l'écriture, elle confirme ce qu'elle a vu cité.
   */
  const confirm = useMutation({
    mutationFn: async () => {
      // Une proposition calculable prime toujours sur une proposition ancienne :
      // le Socle a pu changer d'avis (droit du pack, résidu). Le RPC remplace la
      // proposition existante ; une écriture non équilibrée n'est jamais confirmée.
      let ecritureId: string | null = null;
      if (proposal) {
        if (!pme.packId || !proposal.pivot.approvable) throw new Error(t("pme.confirm.review"));
        ecritureId = await office().office.propose({
          pieceId,
          journal: proposal.journal,
          date: proposal.pivot.entry_date,
          libelle: proposal.libelle,
          packVersionId: pme.packId,
          devise: proposal.pivot.currency,
          lignes: proposal.lignes,
        });
      } else {
        // Jamais de repli sur une proposition ancienne : sans calcul du Socle,
        // il n'y a rien à confirmer, et la raison est affichée telle quelle.
        throw new Error(
          proposalAttempt && !proposalAttempt.ok ? proposalAttempt.reason : t("pme.confirm.review"),
        );
      }
      if (!ecritureId) throw new Error(t("pme.confirm.review"));
      await office().office.book(ecritureId);
    },
    onSuccess: async () => {
      setError(null);
      setRegle(true);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  if (dossier.isPending)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!dossier.data) return <p className="text-sm text-signal-warn">{t("common.error")}</p>;

  const { piece, contenu, extraction, citations } = dossier.data;
  const sensIndetermine =
    extraction != null &&
    (extraction.payload as { document_kind?: string | null } | null)?.document_kind == null;
  // Une citation par champ : la dernière écrite est celle qui fait foi.
  const byField = new Map(citations.map((c) => [c.field, c]));
  const payload = extraction?.payload as ExtractPayload | undefined;
  const confirmable = Boolean(proposal?.pivot.approvable);

  /** Un montant du Socle, dans la langue du lecteur — ou rien s'il n'y en a pas. */
  const lisible = (valeur: string | undefined) =>
    valeur === undefined ? null : montant(valeur, locale);

  /** « 2026-08-31 » se lit mal ; « 31/08/2026 » se lit. */
  const jourLisible = (iso: string | undefined) => {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  /**
   * « Classé dans … » — le libellé du compte principal que le Socle a retenu.
   *
   * Pas une catégorie d'écran : la première ligne de l'écriture proposée, donc
   * exactement ce qui sera comptabilisé. Dire autre chose ici serait promettre
   * un classement que le grand livre ne confirmerait pas.
   */
  const classement = proposal?.lignes[0]?.libelle ?? t("pme.regle.classe.inconnu");

  /** La TVA du document, telle que la lecture l'a relevée. */
  const tvaDuDoc = payload?.totals?.vat ? montant(payload.totals.vat, locale) : null;

  /**
   * Le parcours de la pièce, étape par étape.
   *
   * L'ordre est le NÔTRE : une pièce est comptabilisée avant d'être vue par
   * le cabinet. Reprendre l'ordre de la maquette aurait dessiné un circuit
   * qui n'existe pas dans le produit.
   */
  const rang: Record<string, number> = {
    capturee: 1,
    lue: 2,
    proposee: 3,
    comptabilisee: 4,
    supervisee: 5,
    retournee: 3,
  };
  const atteint = rang[piece.status] ?? 1;
  const etapes = (
    [
      ["recue", 1],
      ["lue", 2],
      ["confirmee", 3],
      ["comptee", 4],
      ["vue", 5],
      ["declaree", 6],
    ] as const
  ).map(([cle, seuil]) => ({
    cle,
    label: t(`pme.parcours.${cle}` as MessageKey),
    // « Déclarée » n'a pas encore d'état dans le produit : elle reste en
    // attente plutôt que de laisser croire que le parcours s'arrête avant.
    etat: seuil > atteint ? "attente" : seuil === atteint ? "courante" : "faite",
  }));

  /** Les articles relevés sur la pièce. Le contrat les porte ; l'écran les montre. */
  const articles = payload?.articles ?? [];

  /** Le numéro porté par le document, s'il en porte un. */
  const reference = payload?.references
    ? (Object.values(payload.references).find((v) => v && v.trim().length > 0) ?? null)
    : null;
  const blockReason = proposalAttempt && !proposalAttempt.ok ? proposalAttempt.reason : null;

  /**
   * Trois lignes, chacune pointant sa source.
   *
   * Le prototype ne montre ni base ni TTC dans le détail : l'émetteur, la
   * date, et LA TVA — parce que c'est la seule des trois qui soit de l'argent
   * pour le dirigeant. Le total, lui, est déjà encadré au-dessus.
   */
  const lignesCitees: Array<{ cle: string; label: string; valeur: string | null; champ: string }> =
    [
      {
        cle: "issuer",
        label: t("pme.extract.issuer"),
        valeur: payload?.issuer ?? null,
        champ: "issuer",
      },
      {
        cle: "date",
        label: t("pme.extract.date"),
        valeur: jourLisible(payload?.document_date),
        champ: "document_date",
      },
      {
        cle: "tva",
        label:
          payload?.document_kind === "facture_vente"
            ? t("pme.verifie.tvaCollectee")
            : t("pme.verifie.tvaRecuperee"),
        valeur: lisible(payload?.totals?.vat),
        champ: "totals.vat",
      },
    ];

  const voirLaSource = (champ: string) => {
    const c = byField.get(champ);
    if (!c) return;
    setZoom(c);
    setPiece(true);
  };

  /* ============================================================== JE LIS
   *
   * Plein écran, sans la barre basse : le prototype la retire pendant la
   * lecture et pendant le soulagement. Ce sont les deux seuls moments où le
   * produit demande qu'on ne fasse rien d'autre.
   *
   * Une barre de progression mentirait — la lecture n'a pas d'étapes connues
   * d'avance. Un souffle dit la vérité : je travaille, et je ne sais pas
   * encore pour combien de temps.
   */
  if (read.isPending || attente || etat.data?.enCours) {
    return (
      <div className="rg-rise fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-11 text-center">
        <RegalicaAvatar size={66} alt="Regalica" rond />
        <p className="mt-[26px] text-[19px] leading-[1.5] tracking-[-0.01em]">
          {t("pme.lecture.titre")}
        </p>
        <p className="mt-2 text-[14px] leading-[1.6] text-text-2">{t("pme.lecture.sous")}</p>
        <div className="rg-breathe mt-[30px] h-0.5 w-[130px] bg-foreground" />
        {/*
         * Le prototype annonce « Relevé · 312 mots situés ». On ne l'affiche
         * que lorsqu'un relevé existe déjà — à la relecture d'une pièce. En
         * première lecture le compte n'existe pas encore, et l'inventer
         * contredirait la phrase juste au-dessus.
         */}
        {dossier.data && dossier.data.tokens.length > 0 ? (
          <p className="mt-[26px] font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("pme.lecture.releve", { mots: dossier.data.tokens.length })}
          </p>
        ) : null}
      </div>
    );
  }

  /* ========================================================== C'EST RÉGLÉ
   *
   * Le pic de soulagement, plein écran lui aussi, et il n'arrive qu'UNE fois
   * — à la confirmation. Rouvrir une facture comptabilisée trois jours plus
   * tard ne rejoue pas la coche : on fête la confirmation, pas l'état.
   */
  if (regle) {
    return (
      <div className="rg-rise fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-10 text-center">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 12.5l5 5L20 6.5" strokeDasharray="34" className="rg-draw" />
        </svg>
        <p className="mt-5 text-[27px] font-semibold tracking-[-0.03em]">{t("pme.regle.titre")}</p>
        <p className="mt-2.5 max-w-[280px] text-[15px] leading-[1.55] text-text-2">
          {/*
           * On ne dit « transmis » que si la pièce l'est VRAIMENT.
           *
           * Cette phrase annonçait la transmission au cabinet dans tous les
           * cas, parce que la capture partageait tout d'office. Maintenant que
           * la transmission est un geste, la promettre sans qu'elle ait eu
           * lieu serait un mensonge — et sur une pièce comptable, un mensonge
           * qui coûte cher à découvrir.
           */}
          {cabinet.data && piece.vis === "partage"
            ? t("pme.regle.classe.cabinet", { classe: classement, cabinet: cabinet.data.name })
            : t("pme.regle.classe", { classe: classement })}
        </p>
        {tvaDuDoc ? (
          <span className="mt-6 inline-flex items-center gap-2 border border-signal-ok px-3.5 py-2 text-[13px] font-semibold text-signal-ok">
            <span aria-hidden className="h-[5px] w-[5px] bg-current" />
            {payload?.document_kind === "facture_vente"
              ? t("pme.regle.tva.collectee", { montant: tvaDuDoc, devise: pme.currency })
              : t("pme.regle.tva.recuperable", { montant: tvaDuDoc, devise: pme.currency })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setRegle(false)}
          className="mt-[34px] border-b border-line-strong pb-[3px] text-[13px] font-medium text-muted-foreground"
        >
          {t("pme.regle.voir")}
        </button>
      </div>
    );
  }

  /* ============================================================ LA PIÈCE
   *
   * La visionneuse n'occupe plus la moitié de l'écran en permanence : le
   * prototype ne la montre nulle part dans le parcours. Elle s'ouvre par
   * « Voir la facture », ou par une source citée — et c'est alors la zone
   * exacte qui s'affiche, ce qui est tout l'intérêt.
   */
  if (montrerPiece) {
    return (
      <div className="fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-3">
          <button
            type="button"
            onClick={() => setPiece(false)}
            className="text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          {zoom ? (
            <span className="num ms-auto text-[11px] uppercase tracking-wide text-muted-foreground">
              {zoom.field}
            </span>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-[22px]">
          {contenu ? (
            <DocumentView contenu={contenu} highlight={zoom} label={t("pme.piece.title")} />
          ) : (
            <p className="border border-border bg-card p-4 text-xs text-muted-foreground">
              {t("pme.doc.error")}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ====================================================== LE DÉTAIL DES LIGNES
   *
   * Ce que le dirigeant reconnaît. Il se souvient d'avoir acheté trois cents
   * ramettes, pas d'un total hors taxe — et c'est en relisant les
   * désignations et les prix unitaires qu'il repère une erreur de lecture que
   * les totaux, eux, ne trahissent pas.
   *
   * Les articles viennent du contrat de lecture, jamais d'une saisie.
   */
  if (montrerDetail) {
    return (
      <div className="fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-3">
          <button
            type="button"
            onClick={() => setDetail(false)}
            className="text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          <span className="num ms-auto text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("pme.detail.compte", { count: articles.length })}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-[22px] py-4">
          <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {t("pme.detail.titre")}
          </p>
          {articles.length === 0 ? (
            <p className="mt-4 border border-border bg-card p-4 text-[13.5px] leading-[1.55] text-text-2">
              {t("pme.detail.aucun")}
            </p>
          ) : (
            <div className="mt-4">
              {articles.map((a, i) => (
                <div key={i} className="border-t border-border py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] font-medium">{a.designation}</span>
                    <span className="num flex-none text-[13.5px] font-medium">
                      {lisible(a.total_ht ?? undefined) ?? "—"}
                    </span>
                  </div>
                  <p className="num mt-1 text-[11.5px] text-muted-foreground">
                    {a.quantity
                      ? t("pme.detail.qte", { q: quantite(a.quantity, locale) })
                      : t("pme.detail.sansQte")}
                    {a.unit_price_ht
                      ? " · " + t("pme.detail.pu", { pu: lisible(a.unit_price_ht) ?? "—" })
                      : ""}
                    {a.tax_code ? " · " + a.tax_code : ""}
                  </p>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-foreground py-3">
                <span className="text-[13.5px] font-semibold">{t("pme.extract.base")}</span>
                <span className="num text-[13.5px] font-semibold">
                  {lisible(payload?.totals?.base_ht) ?? "—"}
                </span>
              </div>
            </div>
          )}
          <p className="mt-4 text-[11.5px] leading-[1.5] text-muted-foreground">
            {t("pme.detail.provenance")}
          </p>
        </div>
      </div>
    );
  }

  /* ========================================================= PAS ENCORE LUE
   *
   * Le scan final, en grand, AVANT le geste : c'est lui qui sera lu, pas
   * l'aperçu de l'appareil photo. Deux gestes seulement — lire, ou retirer
   * et reprendre. Rien ne part tant que la personne n'a pas vu.
   */
  if (!extraction) {
    return (
      <div className="rg-rise flex flex-col gap-4 px-1 pt-2">
        <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
          {t("pme.piece.title")}
        </p>
        <p className="text-[13.5px] leading-[1.55] text-text-2">{t("pme.scan.final")}</p>
        {pagesScan.length > 0 ? (
          <div className="flex flex-col gap-3">
            {pagesScan.map((url, i) => (
              <figure key={url} className="border border-border bg-card">
                <img src={url} alt={t("pme.scan.page", { n: i + 1 })} className="block w-full" />
                {pagesScan.length > 1 ? (
                  <figcaption className="num px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("pme.scan.page", { n: i + 1 })}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : contenu ? (
          <DocumentView contenu={contenu} highlight={null} label={t("pme.piece.title")} />
        ) : (
          <p className="border border-border bg-card p-4 text-xs text-muted-foreground">
            {t("pme.doc.error")}
          </p>
        )}
        <button
          type="button"
          onClick={() => read.mutate()}
          className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background"
        >
          {t("pme.read.run")}
        </button>
        <button
          type="button"
          onClick={() => reprendre.mutate()}
          disabled={reprendre.isPending}
          className="h-[48px] w-full border border-border text-[14px] font-medium disabled:opacity-40"
        >
          {t("pme.scan.reprendre")}
        </button>
        {error ? <p className="text-xs text-signal-warn">{error}</p> : null}
      </div>
    );
  }

  /* ============================================== JE VÉRIFIE  /  LA PIÈCE LUE
   *
   * Une seule colonne, comme le prototype. Avant confirmation c'est une
   * question ; après, c'est le parcours de la pièce en une ligne.
   */
  return (
    <div className="rg-rise flex flex-col gap-0 px-1 pt-2">
      {booked ? (
        <>
          <button
            type="button"
            onClick={() => void navigateList()}
            className="self-start text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          <p className="mt-3 text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {payload?.issuer ?? t("pme.piece.title")}
          </p>
          <p className="num mt-[5px] text-[13.5px] font-medium text-text-2">
            {reference ? reference + " · " : ""}
            {lisible(payload?.totals?.ttc) ?? "—"} {payload?.currency ?? pme.currency}
          </p>
          <Parcours etapes={etapes} />
        </>
      ) : (
        <p className="text-[25px] font-semibold leading-[1.15] tracking-[-0.025em]">
          {t("pme.verifie.titre.1")}
          <br />
          {t("pme.verifie.titre.2")}
        </p>
      )}

      {/* Ce que la lecture a relevé, brut, tel que la pièce le dit. */}
      <div className="mt-4 border border-border bg-card">
        <div className="border-b border-border px-4 py-3.5 font-mono text-[11px] leading-[1.85] text-text-2">
          {payload?.issuer ?? "—"}
          {reference ? " · " + reference : ""}
          <br />
          {t("pme.extract.base")} {lisible(payload?.totals?.base_ht) ?? "—"}
          <br />
          {t("pme.extract.vat")} {lisible(payload?.totals?.vat) ?? "—"}
        </div>
        <div className="flex items-center justify-between gap-3 bg-secondary px-4 py-3.5">
          <span className="text-[13px] font-semibold">{t("pme.verifie.total")}</span>
          <span className="num border border-foreground px-2.5 py-[3px] text-[17px] font-medium">
            {lisible(payload?.totals?.ttc) ?? "—"}
          </span>
        </div>
      </div>

      <div className="mt-[22px] flex items-baseline justify-between gap-3 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {booked ? t("pme.piece.jaiLu") : t("pme.verifie.source")}
        </p>
        {articles.length > 0 ? (
          <button
            type="button"
            onClick={() => setDetail(true)}
            className="border-b border-dotted border-current text-[11px] font-medium text-signal-info"
          >
            {t("pme.detail.voir")}
          </button>
        ) : null}
      </div>

      {lignesCitees.map((l) => (
        <div
          key={l.cle}
          className="flex items-center justify-between gap-3 border-t border-border py-[11px]"
        >
          <span className="text-[13.5px] text-text-2">{l.label}</span>
          {l.cle === "date" && l.valeur === null ? (
            /*
             * La pièce ne porte pas de date lisible. On propose le jour du
             * scan — affiché, modifiable — plutôt que de bloquer. Il ne
             * devient la date de l'écriture qu'à la confirmation.
             */
            <span className="flex flex-col items-end gap-1">
              <input
                type="date"
                value={dateRetenue}
                onChange={(e) => setDateSaisie(e.target.value)}
                className="num border border-border bg-card px-2 py-1 text-[13.5px] font-medium"
              />
              <span className="text-[11px] text-muted-foreground">{t("piece.date.duScan")}</span>
            </span>
          ) : (
            <span className="num text-[13.5px] font-medium">
              {l.valeur ?? "—"}
              {byField.get(l.champ) ? (
                <button
                  type="button"
                  onClick={() => voirLaSource(l.champ)}
                  className="ms-2 border-b border-dotted border-current text-[11px] font-medium text-signal-info"
                >
                  {t("pme.citation.source")}
                </button>
              ) : null}
            </span>
          )}
        </div>
      ))}

      {booked ? (
        <div className="flex items-center justify-between gap-3 border-t border-foreground py-3">
          <span className="text-[13.5px] font-semibold">{t("pme.piece.classee")}</span>
          <span className="text-[13.5px]">{classement}</span>
        </div>
      ) : null}

      {/* Sa question, pas un ordre : c'est le dirigeant qui tranche. */}
      {!booked ? (
        <div className="mt-5 flex gap-3">
          <RegalicaAvatar size={32} alt="Regalica" rond />
          <p className="text-[15px] leading-[1.5]">
            {payload?.totals?.ttc
              ? t("pme.verifie.question", {
                  montant: lisible(payload.totals.ttc) ?? "",
                  devise: payload.currency ?? pme.currency,
                })
              : t("pme.verifie.question.sansTotal")}
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-signal-warn">{error}</p> : null}

      <div className="mt-6 flex flex-col gap-0.5 pb-2">
        {booked ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPiece(true)}
              className="h-12 bg-foreground text-[14px] font-semibold text-background"
            >
              {t("pme.piece.voir")}
            </button>
            <button
              type="button"
              onClick={() => setDetail(true)}
              className="h-12 border border-foreground text-[14px] font-semibold"
            >
              {t("pme.detail.voir")}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={confirm.isPending || !confirmable}
              onClick={() => confirm.mutate()}
              className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background disabled:opacity-50"
            >
              {confirm.isPending ? t("pme.confirm.pending") : t("pme.verifie.oui")}
            </button>
            {/*
             * « Corriger » reprend la PHOTO, comme le prototype. Relancer la
             * lecture serait de toute façon refusé : R7 interdit d'effacer un
             * relevé, et c'est par là que commence `capture_read_persist`.
             */}
            <button
              type="button"
              onClick={pme.ouvrirScanner}
              className="h-[50px] w-full text-[16px] font-medium"
            >
              {t("pme.verifie.corriger")}
            </button>
            {sensIndetermine ? (
              /*
               * La lecture n'a pas pu dire si la pièce est un achat ou une
               * vente : ni l'émetteur ni le destinataire n'est ce dossier.
               * Elle ne devine pas ; elle demande. La réponse est enregistrée
               * à côté de la lecture, datée et signée.
               */
              <div className="mt-2 border border-border bg-card p-4">
                <p className="text-[14px] font-medium">{t("pme.sens.question")}</p>
                <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">
                  {t("pme.sens.pourquoi")}
                </p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => preciser.mutate("facture_achat")}
                    disabled={preciser.isPending}
                    className="min-h-[46px] border border-foreground px-3 text-[14px] font-medium disabled:opacity-40"
                  >
                    {t("pme.sens.achat")}
                  </button>
                  <button
                    type="button"
                    onClick={() => preciser.mutate("facture_vente")}
                    disabled={preciser.isPending}
                    className="min-h-[46px] border border-foreground px-3 text-[14px] font-medium disabled:opacity-40"
                  >
                    {t("pme.sens.vente")}
                  </button>
                </div>
              </div>
            ) : !confirmable ? (
              <p className="pt-2 text-center text-[12.5px] text-signal-warn">
                {blockReason ?? t("pme.confirm.review")}
              </p>
            ) : null}

            {/*
             * ==================================== LA TRANSMISSION EST UN GESTE
             *
             * Toute pièce photographiée partait au cabinet automatiquement —
             * un reçu personnel, une photo ratée, un document sans rapport.
             * Personne ne l'avait décidé.
             *
             * Elle reste maintenant chez le dirigeant jusqu'à ce qu'il appuie.
             * Et l'écran dit toujours où elle en est : chez vous, ou partie.
             */}
            {cabinet.data ? (
              <div className="mt-4 border-t border-border pt-4">
                {piece.vis === "partage" ? (
                  <p className="text-center text-[12.5px] text-signal-ok">
                    {t("pme.transmettre.faite", { cabinet: cabinet.data.name })}
                  </p>
                ) : (
                  <>
                    <p className="pb-2.5 text-center text-[12.5px] text-text-2">
                      {t("pme.transmettre.chezvous")}
                    </p>
                    <button
                      type="button"
                      disabled={transmettre.isPending}
                      onClick={() => transmettre.mutate()}
                      className="h-[50px] w-full border border-foreground text-[15px] font-medium disabled:opacity-50"
                    >
                      {transmettre.isPending
                        ? t("common.loading")
                        : t("pme.transmettre.action", { cabinet: cabinet.data.name })}
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {/* Effacer : offert seulement tant que la pièce n'est partie nulle
                part. La base refuse de toute façon dans les autres cas. */}
            {piece.vis === "personnel" &&
            (piece.status === "capturee" || piece.status === "lue") ? (
              <div className="mt-3">
                {confirmerSuppression ? (
                  <div className="space-y-2 border border-signal-warn p-3">
                    <p className="text-center text-[12.5px] text-signal-warn">
                      {t("pme.supprimer.sur")}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={supprimer.isPending}
                        onClick={() => supprimer.mutate()}
                        className="h-[44px] flex-1 bg-signal-warn text-[14px] font-semibold text-background disabled:opacity-50"
                      >
                        {supprimer.isPending ? t("common.loading") : t("pme.supprimer.oui")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmerSuppression(false)}
                        className="h-[44px] flex-1 border border-border text-[14px] font-medium"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmerSuppression(true)}
                    className="w-full py-2 text-center text-[12.5px] text-muted-foreground underline underline-offset-4"
                  >
                    {t("pme.supprimer.action")}
                  </button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Le parcours d'une pièce, en une ligne.
 *
 * Les six étapes sont celles du prototype, dans NOTRE ordre : chez nous une
 * pièce est comptabilisée avant d'être vue par le cabinet, pas l'inverse.
 * Garder l'ordre de la maquette aurait dessiné un circuit qui n'existe pas.
 *
 * « Déclarée » reste toujours en attente : rien dans le produit ne marque
 * encore qu'une pièce est partie avec une déclaration. Une étape grise qui
 * dit « pas encore » vaut mieux qu'une étape absente qui laisse croire que le
 * parcours s'arrête là.
 */
function Parcours({ etapes }: { etapes: Array<{ cle: string; label: string; etat: string }> }) {
  return (
    <div className="relative mt-[22px] grid grid-cols-6 items-start">
      <span aria-hidden className="absolute inset-x-[8%] top-[5px] h-px bg-line-strong" />
      {etapes.map((e) => (
        <span key={e.cle} className="relative flex flex-col items-center gap-2">
          <span
            aria-hidden
            className={
              e.etat === "courante"
                ? "h-[13px] w-[13px] -mt-px bg-marigold"
                : e.etat === "faite"
                  ? "h-[11px] w-[11px] bg-foreground"
                  : "h-[11px] w-[11px] border-[1.5px] border-line-strong bg-background"
            }
          />
          <span
            className={
              "text-center text-[8.5px] font-semibold uppercase tracking-[0.06em] " +
              (e.etat === "courante"
                ? "text-marigold"
                : e.etat === "faite"
                  ? ""
                  : "text-muted-foreground")
            }
          >
            {e.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string | null;
  citation: Citation | null;
  onZoom: (c: Citation | null) => void;
  zoomLabel: string;
  missingLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 bg-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</dt>
      <dd className="text-end">
        <span className={props.mono ? "num" : ""}>{props.value ?? "—"}</span>
        <button
          type="button"
          onClick={() => props.onZoom(props.citation)}
          disabled={!props.citation}
          className="ms-3 min-h-[44px] text-[11px] uppercase tracking-wide text-muted-foreground underline disabled:no-underline"
        >
          {props.citation ? props.zoomLabel : props.missingLabel}
        </button>
      </dd>
    </div>
  );
}

function Amount(props: {
  label: string;
  value: string | null;
  citation: Citation | null;
  onZoom: (c: Citation | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onZoom(props.citation)}
      disabled={!props.citation}
      className="min-h-[48px] min-w-0 border border-border px-3 py-2 text-start disabled:opacity-60"
    >
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      <span className="num block break-words">{props.value ?? "—"}</span>
    </button>
  );
}
